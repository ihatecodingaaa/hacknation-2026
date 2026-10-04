import { ACTIONS, ACTION_ORDER } from "./actions";
import { DEPENDS_ON, SIGNALS, signalState } from "./signals";
import { computeConfidence } from "./rules";
import type {
  ActionId,
  CounterfactualAnswer,
  CounterfactualQuestion,
  CounterfactualStance,
  DecisionRule,
  Evidence,
  Guardrail,
  IncidentSignal,
  RuleCondition,
  SignalCategory,
  SignalId,
  TranscriptSource,
} from "./types";

// The counterfactual probes the edge of the rule.
//
// The expert cited some signals. Other abnormal signals were on screen but not
// mentioned. If an unmentioned signal of the same kind (latency vs errors)
// could stand in for a cited one, the rule might be broader than the expert
// said. So we ask: swap them, would you still make the same call?

const PIVOT_PRIORITY: SignalCategory[] = ["symptom", "scope", "change", "resource"];

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function generateCounterfactual(
  rule: DecisionRule,
  signals: IncidentSignal[],
): CounterfactualQuestion | null {
  const cited = rule.conditions
    .filter((c) => c.expected === "present" && c.anyOf.length === 1)
    .map((c) => c.anyOf[0]);
  if (cited.length === 0) return null;

  const citedSet = new Set(rule.conditions.flatMap((c) => c.anyOf));
  const uncited = signals
    .filter((s) => s.state === "present" && !citedSet.has(s.id))
    .map((s) => s.id);

  const byPriority = [...cited].sort(
    (a, b) =>
      PIVOT_PRIORITY.indexOf(SIGNALS[a].category) - PIVOT_PRIORITY.indexOf(SIGNALS[b].category),
  );

  let pivot: SignalId = byPriority[0];
  let confounder: SignalId | null = null;
  for (const candidate of byPriority) {
    const match = uncited.find((u) => SIGNALS[u].category === SIGNALS[candidate].category);
    if (match) {
      pivot = candidate;
      confounder = match;
      break;
    }
  }

  const verb = ACTIONS[rule.action].verb;
  const pivotMeta = SIGNALS[pivot];

  if (confounder) {
    const conf = SIGNALS[confounder];
    return {
      pivot,
      confounder,
      question: `If ${conf.presentPhrase} but ${pivotMeta.absentPhrase}, would you still ${verb}?`,
      rationale:
        `${capitalize(conf.noun)} was also on screen, but you did not mention it. ` +
        `If ${conf.noun} on its own would make you ${verb}, the rule is broader than you said. ` +
        `This tests whether ${pivotMeta.noun} is really required.`,
      hypothetical: [
        { signal: pivot, from: signalState(signals, pivot), to: "absent" },
        { signal: confounder, from: signalState(signals, confounder), to: "present" },
      ],
    };
  }

  return {
    pivot,
    confounder: null,
    question: `If ${pivotMeta.absentPhrase}, would you still ${verb}?`,
    rationale: `No other abnormal signal of the same kind was on screen. This tests whether ${pivotMeta.noun} is really required for you to ${verb}.`,
    hypothetical: [{ signal: pivot, from: signalState(signals, pivot), to: "absent" }],
  };
}

const SWITCH_LEAD = /^\s*(no\b|nope\b|nah\b|never\b|not\b|definitely\s+not\b|probably\s+not\b|i\s+(would\s+not|wouldn'?t)\b|i'?d\s+not\b)/i;
const STILL_LEAD = /^\s*(yes\b|yeah\b|yep\b|yup\b|still\b|definitely\b|absolutely\b|i\s+would\s+still\b|i'?d\s+still\b)/i;
const SWITCH_ANY = /\b(wouldn'?t|would\s+not|won'?t|not\s+enough)\b/i;
const STILL_ANY = /\b(would\s+still|i'?d\s+still|still\s+roll|still\s+do)\b/i;

/** Read the expert's stance, and the words it was read from. null = unclear, ask the expert to pick. */
export function readStance(text: string): { stance: CounterfactualStance | null; cue: string | null } {
  const order: [RegExp, CounterfactualStance][] = [
    [SWITCH_LEAD, "switch"],
    [STILL_LEAD, "still"],
    [STILL_ANY, "still"],
    [SWITCH_ANY, "switch"],
  ];
  for (const [re, stance] of order) {
    const m = re.exec(text);
    if (m) return { stance, cue: m[0].trim() };
  }
  return { stance: null, cue: null };
}

export function classifyStance(text: string): CounterfactualStance | null {
  return readStance(text).stance;
}

/** First action mentioned in the answer other than the rule's own action, and the words that named it. */
export function findAlternative(text: string, ruleAction: ActionId): { action: ActionId | null; cue: string | null } {
  for (const id of ACTION_ORDER) {
    if (id === ruleAction) continue;
    const m = ACTIONS[id].keywords.exec(text);
    if (m) return { action: id, cue: m[0] };
  }
  return { action: null, cue: null };
}

export function detectAlternative(text: string, ruleAction: ActionId): ActionId | null {
  return findAlternative(text, ruleAction).action;
}

export interface AnswerReading {
  text: string;
  source: TranscriptSource;
  stance: CounterfactualStance | null;
  alternative: ActionId | null;
  /** The words each part of the reading came from, shown to the expert. */
  cues: { stance: string | null; alternative: string | null };
  /** Why the expert should look closely before confirming. */
  concerns: string[];
}

/**
 * A draft reading of the counterfactual answer. It never changes the rule by
 * itself: live and typed answers wait for the expert to confirm or correct it.
 */
export function interpretAnswer(text: string, source: TranscriptSource, ruleAction: ActionId): AnswerReading {
  const { stance, cue } = readStance(text);
  const alt = stance === "switch" ? findAlternative(text, ruleAction) : { action: null, cue: null };
  const concerns: string[] = [];
  if (!stance) concerns.push("Could not tell whether this is a yes or a no.");
  if (stance && cue && cue.split(/\s+/).length === 1) {
    concerns.push(`The stance rests on a single word ("${cue}"). Speech recognition can mishear the rest.`);
  }
  if (stance === "switch" && !alt.action) concerns.push("No alternative action was named. Pick what the expert would do instead.");
  return { text, source, stance, alternative: alt.action, cues: { stance: cue, alternative: alt.cue }, concerns };
}

/** The rule's other conditions that the counterfactual kept constant. */
export function heldContext(rule: DecisionRule, pivot: SignalId): Guardrail["trigger"] {
  return rule.conditions
    .filter((c) => c.anyOf.length === 1 && c.anyOf[0] !== pivot && !(DEPENDS_ON[c.anyOf[0]] ?? []).includes(pivot))
    .map((c) => ({ signal: c.anyOf[0], state: c.expected }));
}

/** Produce the next rule version from the counterfactual answer. */
export function applyCounterfactual(
  rule: DecisionRule,
  cf: CounterfactualQuestion,
  answer: CounterfactualAnswer,
): DecisionRule {
  const reading =
    answer.stance === "switch"
      ? `would not ${ACTIONS[rule.action].verb}${answer.alternative ? `; would ${ACTIONS[answer.alternative].verb} instead` : ""}`
      : `would still ${ACTIONS[rule.action].verb}`;
  const cfEvidence: Evidence = {
    id: "ev-cf",
    kind: "counterfactual",
    text:
      `Q: ${cf.question}\nA: ${answer.text}\n` +
      `Read as: ${reading} (${answer.confirmedBy === "expert" ? "confirmed by the expert" : "scripted demo answer, applied as written"})`,
    source: answer.source,
    incidentId: rule.sourceIncidentId,
  };
  const evidence = [...rule.evidence.filter((e) => e.id !== cfEvidence.id), cfEvidence];
  const pivotId = `c-${cf.pivot}`;
  const pivotLabel = SIGNALS[cf.pivot].label.toLowerCase();
  const version = rule.version + 1;
  const baseFactors = rule.confidence.factors.filter((f) => !f.label.startsWith("Counterfactual"));

  if (answer.stance === "switch") {
    // A "no" without what to do instead would be an actionless policy the
    // expert never stated. The session asks for the alternative first.
    if (!answer.alternative) return rule;
    const conditions: RuleCondition[] = rule.conditions.map((c) =>
      c.id === pivotId
        ? { ...c, necessity: "confirmed", testedIn: version, evidenceIds: [...c.evidenceIds, cfEvidence.id] }
        : c,
    );

    // The expert answered about one change with everything else held. The
    // guardrail fires only in that situation: the probed signal flipped, the
    // confounder present, and the rule's other conditions still holding
    // (except those that cannot hold once the probed signal is gone).
    const trigger: Guardrail["trigger"] = [
      ...(cf.confounder ? [{ signal: cf.confounder, state: "present" as const }] : []),
      { signal: cf.pivot, state: "absent" },
      ...heldContext(rule, cf.pivot),
    ];
    const alt = answer.alternative;
    const when = cf.confounder
      ? `${capitalize(SIGNALS[cf.confounder].presentPhrase)} but ${SIGNALS[cf.pivot].absentPhrase}`
      : capitalize(SIGNALS[cf.pivot].absentPhrase);
    const guardrail: Guardrail = {
      id: `g-cf-${cf.pivot}`,
      description: `${when}: ${ACTIONS[alt].verb} instead of ${ACTIONS[rule.action].gerund}.`,
      trigger,
      insteadAction: alt,
      origin: "counterfactual",
      evidenceIds: [cfEvidence.id],
      introducedIn: version,
    };

    return {
      ...rule,
      version,
      conditions,
      guardrails: [...rule.guardrails.filter((g) => g.id !== guardrail.id), guardrail],
      evidence,
      confidence: computeConfidence([
        ...baseFactors,
        { label: `Counterfactual confirmed "${pivotLabel}" is required`, delta: 0.2 },
      ]),
      history: [
        ...rule.history,
        {
          version,
          summary: `Counterfactual: "${pivotLabel}" confirmed as required, guardrail added`,
        },
      ],
      changedIds: [pivotId, guardrail.id],
    };
  }

  // "still" with nothing to broaden to, on the rule's only condition: dropping
  // it would leave a rule that acts on no evidence at all. Keep the condition,
  // record the answer, and lower evidence strength: the deciding reason has not
  // been captured yet.
  if (!cf.confounder && rule.conditions.length <= 1) {
    return {
      ...rule,
      version,
      evidence,
      confidence: computeConfidence([
        ...baseFactors,
        { label: "Counterfactual: the stated reason did not decide it; the real condition is not captured yet", delta: -0.1 },
      ]),
      history: [
        ...rule.history,
        {
          version,
          summary: `Counterfactual: expert would act without "${pivotLabel}"; kept as the only observable condition`,
        },
      ],
      changedIds: [],
    };
  }

  // "still": the cited signal was not necessary. Broaden or drop the condition.
  const conditions: RuleCondition[] = cf.confounder
    ? rule.conditions.map((c) =>
        c.id === pivotId
          ? {
              ...c,
              anyOf: [...c.anyOf, cf.confounder as SignalId],
              necessity: "broadened",
              testedIn: version,
              evidenceIds: [...c.evidenceIds, cfEvidence.id],
            }
          : c,
      )
    : rule.conditions.filter((c) => c.id !== pivotId);

  return {
    ...rule,
    version,
    conditions,
    evidence,
    confidence: computeConfidence([
      ...baseFactors,
      { label: "Counterfactual probed the boundary, rule broadened", delta: 0.1 },
    ]),
    history: [
      ...rule.history,
      {
        version,
        summary: cf.confounder
          ? `Counterfactual: "${pivotLabel}" broadened to include ${SIGNALS[cf.confounder].label.toLowerCase()}`
          : `Counterfactual: "${pivotLabel}" not required, condition removed`,
      },
    ],
    changedIds: cf.confounder ? [pivotId] : [],
  };
}
