import { ACTIONS } from "./actions";
import { expectedAction } from "./playbook";
import { conditionLabel, evidenceFor } from "./rules";
import { deriveSignals, signalState } from "./signals";
import type {
  ActionId,
  ConditionMatch,
  DecisionRule,
  EvaluationResult,
  IncidentSignal,
  IncidentState,
  RuleMatch,
} from "./types";

/**
 * Check a learned rule against an incident's signals.
 * Order: guardrails first (explicit "do not"), then conditions.
 * Unknown signals never satisfy anything, so missing data cannot fire a rule.
 */
export function matchRule(rule: DecisionRule, signals: IncidentSignal[]): RuleMatch {
  const conditions: ConditionMatch[] = rule.conditions.map((c) => {
    const observed = c.anyOf.map((id) => signalState(signals, id));
    const met = observed.some((s) => s === c.expected)
      ? true
      : observed.some((s) => s === "unknown")
        ? "unknown"
        : false;
    return { conditionId: c.id, anyOf: c.anyOf, expected: c.expected, observed, met };
  });

  const firedGuardrail =
    rule.guardrails.find((g) =>
      g.trigger.every((t) => signalState(signals, t.signal) === t.state),
    ) ?? null;

  if (firedGuardrail) {
    return { outcome: "guardrail", conditions, firedGuardrail, recommended: firedGuardrail.insteadAction };
  }
  // A rule with no conditions has no evidence to act on. It never applies.
  if (conditions.length === 0) {
    return { outcome: "not_applicable", conditions, firedGuardrail: null, recommended: null };
  }
  if (conditions.every((c) => c.met === true)) {
    return { outcome: "applies", conditions, firedGuardrail: null, recommended: rule.action };
  }
  if (conditions.some((c) => c.met === false)) {
    return { outcome: "not_applicable", conditions, firedGuardrail: null, recommended: null };
  }
  return { outcome: "uncertain", conditions, firedGuardrail: null, recommended: null };
}

function label(id: ActionId): string {
  return ACTIONS[id].label;
}

export function evaluateTrainee(
  rule: DecisionRule,
  incident: IncidentState,
  traineeAction: ActionId,
): EvaluationResult {
  const signals = deriveSignals(incident);
  const expected = expectedAction(signals);
  const match = matchRule(rule, signals);
  const trainee = { incidentId: incident.id, action: traineeAction };
  const quote = evidenceFor(rule, ["ev-quote"]);
  const conditionEvidence = rule.conditions.flatMap((c) => c.evidenceIds);
  const metLabels = rule.conditions
    .filter((c) => match.conditions.find((m) => m.conditionId === c.id)?.met === true)
    .map((c) => conditionLabel(c).toLowerCase());

  const base = { trainee, expected, match };

  if (match.outcome === "applies") {
    const provenance = evidenceFor(rule, conditionEvidence.concat("ev-cf"));
    if (traineeAction === rule.action) {
      return {
        ...base,
        verdict: "aligned",
        headline: "Matches the expert's judgment",
        explanation:
          `All ${rule.conditions.length} conditions of the expert's rule hold here (${metLabels.join("; ")}). ` +
          `The expert would also ${ACTIONS[rule.action].verb}.`,
        provenance,
      };
    }
    return {
      ...base,
      verdict: "mismatch",
      headline: "Mismatch with the learned expert rule",
      explanation:
        `This incident matches all ${rule.conditions.length} conditions the expert gave on ${rule.sourceIncidentId}: ` +
        `${metLabels.join("; ")}. The expert would ${ACTIONS[rule.action].verb}, not ${ACTIONS[traineeAction].verb}.` +
        (traineeAction === rule.overAction ? ` That is the runbook answer the expert rejected.` : ""),
      provenance,
    };
  }

  if (match.outcome === "guardrail" && match.firedGuardrail) {
    const g = match.firedGuardrail;
    const provenance = evidenceFor(rule, [...g.evidenceIds, ...quote.map((e) => e.id)]);
    const why = `Guardrail: ${g.description}`;
    if (g.insteadAction) {
      if (traineeAction === g.insteadAction) {
        return {
          ...base,
          verdict: "aligned",
          headline: "Matches the expert's boundary",
          explanation: `${why} The trainee chose ${label(traineeAction).toLowerCase()}, as the expert said they would.`,
          provenance,
        };
      }
      return {
        ...base,
        verdict: "mismatch",
        headline: "Crosses a boundary the expert set",
        explanation: `${why} The expert would ${ACTIONS[g.insteadAction].verb}, not ${ACTIONS[traineeAction].verb}.`,
        provenance,
      };
    }
    if (traineeAction === rule.action) {
      return {
        ...base,
        verdict: "mismatch",
        headline: `${label(rule.action)} is blocked by a guardrail`,
        explanation: `${why} The expert's rule explicitly does not cover this case, so ${label(rule.action).toLowerCase()} is not supported by what was learned.`,
        provenance,
      };
    }
    return {
      ...base,
      verdict: "outside_rule",
      headline: "Outside what the expert taught",
      explanation: `${why} The learned rule stands down here. SecondShift has no expert judgment for this case and does not grade the choice.`,
      provenance,
    };
  }

  if (match.outcome === "uncertain") {
    const unknown = rule.conditions
      .filter((c) => match.conditions.find((m) => m.conditionId === c.id)?.met === "unknown")
      .map((c) => conditionLabel(c).toLowerCase());
    return {
      ...base,
      verdict: "uncertain",
      headline: "Cannot confirm: missing evidence",
      explanation:
        `The expert's rule needs: ${unknown.join("; ")}. The telemetry here cannot show that. ` +
        `Everything else matches, so this may be the same pattern, but SecondShift will not guess. ` +
        `Confirm it before choosing ${label(rule.action).toLowerCase()}.`,
      provenance: evidenceFor(rule, conditionEvidence),
    };
  }

  const failed = rule.conditions
    .filter((c) => match.conditions.find((m) => m.conditionId === c.id)?.met === false)
    .map((c) => conditionLabel(c).toLowerCase());
  return {
    ...base,
    verdict: "outside_rule",
    headline: "Outside what the expert taught",
    explanation: `The rule does not apply: ${failed.join("; ")} ${failed.length === 1 ? "does" : "do"} not hold here. SecondShift has no expert judgment for this case and does not grade the choice.`,
    provenance: evidenceFor(rule, ["ev-quote"]),
  };
}

