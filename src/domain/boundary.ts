import { matchRule } from "./evaluation";
import { expectedAction } from "./playbook";
import { COUPLED, SIGNALS, signalById, signalState } from "./signals";
import type {
  ActionId,
  DecisionRule,
  Guardrail,
  IncidentSignal,
  RuleCondition,
  RuleMatch,
  SignalId,
  SignalState,
} from "./types";

// The Decision Boundary Map.
//
// A learned rule is a region of incident space: "these conditions hold, these
// guardrails do not fire". The map shows that region one condition at a time.
// For each condition we take the incident the expert actually saw, change only
// that condition (flip it, or blank it out as missing data), and run the real
// rule matcher on the result. Every cell is the matcher's answer, not a label.

export type BoundaryOutcome =
  | { kind: "apply"; action: ActionId }
  | { kind: "instead"; action: ActionId; guardrailId: string; origin: Guardrail["origin"]; introducedIn: number }
  | { kind: "stand_down"; guardrailId: string; origin: Guardrail["origin"]; introducedIn: number }
  | { kind: "silent" }
  | { kind: "abstain"; missing: SignalId[] };

export interface SignalChange {
  signal: SignalId;
  from: SignalState;
  to: SignalState;
}

export interface BoundaryCell {
  /** "If {scenario}, ..." */
  scenario: string;
  changes: SignalChange[];
  outcome: BoundaryOutcome;
  /** What the runbook does in this hypothetical (used when the rule is silent or stands down). */
  runbook: ActionId;
  /** Outcome under the previous rule version, when it was different. */
  before: BoundaryOutcome | null;
}

export interface BoundaryAxis {
  conditionId: string;
  label: string;
  signals: SignalId[];
  expected: "present" | "absent";
  necessity: RuleCondition["necessity"];
  quote: string | null;
  introducedIn: number;
  testedIn: number | null;
  /** Measurement on the source incident. */
  observed: string;
  flipped: BoundaryCell;
  missing: BoundaryCell;
}

export interface BoundaryMapData {
  ruleId: string;
  version: number;
  action: ActionId;
  overAction: ActionId;
  sourceIncidentId: string;
  /** The source incident itself: inside the region by construction. */
  inside: BoundaryOutcome;
  axes: BoundaryAxis[];
}

export function outcomeOf(match: RuleMatch, rule: DecisionRule): BoundaryOutcome {
  switch (match.outcome) {
    case "applies":
      return { kind: "apply", action: rule.action };
    case "guardrail": {
      const g = match.firedGuardrail!;
      return g.insteadAction
        ? { kind: "instead", action: g.insteadAction, guardrailId: g.id, origin: g.origin, introducedIn: g.introducedIn }
        : { kind: "stand_down", guardrailId: g.id, origin: g.origin, introducedIn: g.introducedIn };
    }
    case "uncertain":
      return {
        kind: "abstain",
        missing: match.conditions.filter((c) => c.met === "unknown").flatMap((c) => c.anyOf),
      };
    default:
      return { kind: "silent" };
  }
}

function sameOutcome(a: BoundaryOutcome, b: BoundaryOutcome): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function apply(signals: IncidentSignal[], changes: SignalChange[]): IncidentSignal[] {
  return signals.map((s) => {
    const c = changes.find((x) => x.signal === s.id);
    return c ? { ...s, state: c.to } : s;
  });
}

function change(signals: IncidentSignal[], signal: SignalId, to: SignalState): SignalChange {
  return { signal, from: signalState(signals, signal), to };
}

/** The coherent "this condition no longer holds" hypothetical. */
export function flipChanges(cond: RuleCondition, signals: IncidentSignal[]): { scenario: string; changes: SignalChange[] } {
  const opposite = cond.expected === "present" ? "absent" : "present";
  const changes = cond.anyOf.map((id) => change(signals, id, opposite));
  const coupled = cond.anyOf.length === 1 && cond.expected === "present" ? COUPLED[cond.anyOf[0]] : undefined;
  if (coupled) {
    changes.push(change(signals, coupled, "present"));
    return { scenario: SIGNALS[coupled].presentPhrase, changes };
  }
  const scenario =
    cond.anyOf.length > 1
      ? `neither ${cond.anyOf.map((id) => SIGNALS[id].noun).join(" nor ")}`
      : opposite === "absent"
        ? SIGNALS[cond.anyOf[0]].absentPhrase
        : SIGNALS[cond.anyOf[0]].presentPhrase;
  return { scenario, changes };
}

/** The "we cannot measure this condition" hypothetical. */
export function missingChanges(cond: RuleCondition, signals: IncidentSignal[]): { scenario: string; changes: SignalChange[] } {
  const ids = new Set<SignalId>(cond.anyOf);
  for (const id of cond.anyOf) {
    const coupled = COUPLED[id];
    if (coupled) ids.add(coupled);
  }
  return {
    scenario: SIGNALS[cond.anyOf[0]].missingPhrase,
    changes: [...ids].map((id) => change(signals, id, "unknown")),
  };
}

function cell(
  rule: DecisionRule,
  previous: DecisionRule | null,
  signals: IncidentSignal[],
  hypo: { scenario: string; changes: SignalChange[] },
): BoundaryCell {
  const hypothetical = apply(signals, hypo.changes);
  const outcome = outcomeOf(matchRule(rule, hypothetical), rule);
  let before: BoundaryOutcome | null = null;
  if (previous) {
    const prev = outcomeOf(matchRule(previous, hypothetical), previous);
    if (!sameOutcome(prev, outcome)) before = prev;
  }
  return { ...hypo, outcome, runbook: expectedAction(hypothetical).action, before };
}

/**
 * Derive the map for a rule from the signals of the incident it was learned on.
 * Pass the previous rule version to see which cells the latest revision moved.
 */
export function deriveBoundaryMap(
  rule: DecisionRule,
  sourceSignals: IncidentSignal[],
  previous: DecisionRule | null = null,
): BoundaryMapData {
  const axes = rule.conditions.map((c): BoundaryAxis => {
    const prevCond = previous?.conditions.find((p) => p.id === c.id) ?? null;
    return {
      conditionId: c.id,
      label: c.anyOf.map((id) => SIGNALS[id].label).join(" or "),
      signals: c.anyOf,
      expected: c.expected,
      necessity: c.necessity,
      quote: c.quote,
      introducedIn: c.introducedIn,
      testedIn: c.testedIn,
      observed: c.anyOf.map((id) => signalById(sourceSignals, id)?.detail ?? "not measured").join(" · "),
      flipped: cell(rule, prevCond ? previous : null, sourceSignals, flipChanges(c, sourceSignals)),
      missing: cell(rule, prevCond ? previous : null, sourceSignals, missingChanges(c, sourceSignals)),
    };
  });
  return {
    ruleId: rule.id,
    version: rule.version,
    action: rule.action,
    overAction: rule.overAction,
    sourceIncidentId: rule.sourceIncidentId,
    inside: outcomeOf(matchRule(rule, sourceSignals), rule),
    axes,
  };
}

export type AxisPosition = "inside" | "flipped" | "missing";

export interface Placement {
  /** Where the incident sits on each condition axis. */
  positions: Record<string, AxisPosition>;
  /** The incident's own measurement for each axis. */
  details: Record<string, string>;
  outcome: BoundaryOutcome;
  /** Conditions responsible for the outcome when it is not "apply". */
  decisiveAxes: string[];
  runbook: ActionId;
}

/** Where a new incident lands on the map. The outcome is the real matcher's answer. */
export function placeIncident(rule: DecisionRule, signals: IncidentSignal[]): Placement {
  const match = matchRule(rule, signals);
  const positions: Record<string, AxisPosition> = {};
  const details: Record<string, string> = {};
  for (const m of match.conditions) {
    positions[m.conditionId] = m.met === true ? "inside" : m.met === "unknown" ? "missing" : "flipped";
    details[m.conditionId] = m.anyOf.map((id) => signalById(signals, id)?.detail ?? "not measured").join(" · ");
  }
  const outcome = outcomeOf(match, rule);
  let decisiveAxes: string[] = [];
  if (match.firedGuardrail) {
    const triggers = new Set(match.firedGuardrail.trigger.map((t) => t.signal));
    // Context signals in the trigger hold on this incident; only the axes it
    // actually left are the reason for the outcome.
    decisiveAxes = rule.conditions
      .filter((c) => positions[c.id] !== "inside")
      .filter((c) => c.anyOf.some((id) => triggers.has(id) || (COUPLED[id] && triggers.has(COUPLED[id]!))))
      .map((c) => c.id);
  } else if (outcome.kind !== "apply") {
    decisiveAxes = Object.entries(positions)
      .filter(([, p]) => p !== "inside")
      .map(([id]) => id);
  }
  return { positions, details, outcome, decisiveAxes, runbook: expectedAction(signals).action };
}
