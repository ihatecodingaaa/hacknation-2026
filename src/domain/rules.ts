import { ACTIONS } from "./actions";
import { SIGNALS, signalById } from "./signals";
import type {
  Confidence,
  ConfidenceFactor,
  DecisionDivergence,
  DecisionRule,
  Evidence,
  ExpertExplanation,
  Extraction,
  Guardrail,
  IncidentSignal,
  IncidentState,
  RuleCondition,
  SignalCategory,
  SignalId,
} from "./types";

export const CONFIDENCE_CAP = 0.85;
const CAP_REASON = "Learned from one incident. A second confirming case is needed to go higher.";

// Evidence strength is a transparent heuristic: the sum of the listed factors,
// clamped to [0, cap]. It is not a probability and is never presented as one.

const CATEGORY_ORDER: SignalCategory[] = ["change", "symptom", "scope", "resource"];

// Rule v1 has conditions only. The opposite of a stated reason is NOT turned
// into a guardrail: until the counterfactual tests it, "this reason does not
// hold" means the rule is silent (the runbook applies), not an explicit policy
// the expert never gave. Guardrails come from the expert's counterfactual answer.

export function computeConfidence(factors: ConfidenceFactor[]): Confidence {
  const raw = factors.reduce((sum, f) => sum + f.delta, 0);
  const score = Math.round(Math.min(CONFIDENCE_CAP, Math.max(0, raw)) * 100) / 100;
  const level = score < 0.5 ? "low" : score < 0.75 ? "medium" : "high";
  return { score, level, factors, cap: CONFIDENCE_CAP, capReason: CAP_REASON };
}

export interface BuildRuleInput {
  incident: IncidentState;
  signals: IncidentSignal[];
  divergence: DecisionDivergence;
  explanation: ExpertExplanation;
  extraction: Extraction;
}

/** Turn a grounded explanation into rule v1. Returns null if nothing grounded. */
export function buildRule(input: BuildRuleInput): DecisionRule | null {
  const { incident, signals, divergence, explanation, extraction } = input;
  if (extraction.status !== "grounded") return null;

  const quoteEvidence: Evidence = {
    id: "ev-quote",
    kind: "expert_quote",
    text: explanation.text,
    source: explanation.source,
    incidentId: incident.id,
  };
  const evidence: Evidence[] = [quoteEvidence];

  const seen = new Set<SignalId>();
  const grounded = extraction.citations.filter((c) => {
    if (!c.grounded || seen.has(c.signal)) return false;
    seen.add(c.signal);
    return true;
  });
  grounded.sort(
    (a, b) =>
      CATEGORY_ORDER.indexOf(SIGNALS[a.signal].category) -
      CATEGORY_ORDER.indexOf(SIGNALS[b.signal].category),
  );

  const conditions: RuleCondition[] = grounded.map((c) => {
    const sigEvidenceId = `ev-sig-${c.signal}`;
    const measured = signalById(signals, c.signal);
    evidence.push({
      id: sigEvidenceId,
      kind: "signal",
      text: `${SIGNALS[c.signal].label}: ${measured?.detail ?? "observed"}`,
      source: "telemetry",
      incidentId: incident.id,
    });
    return {
      id: `c-${c.signal}`,
      anyOf: [c.signal],
      expected: c.claimed,
      necessity: "stated",
      evidenceIds: [quoteEvidence.id, sigEvidenceId],
      quote: c.quote,
      introducedIn: 1,
      testedIn: null,
    };
  });

  const guardrails: Guardrail[] = [];

  const contradicted = extraction.citations.filter((c) => !c.grounded && c.observed !== "unknown").length;
  const unverifiable = extraction.citations.filter((c) => !c.grounded && c.observed === "unknown").length;
  const factors: ConfidenceFactor[] = [
    { label: "Learned from 1 expert decision", delta: 0.3 },
    {
      label: `${conditions.length} stated reason${conditions.length === 1 ? "" : "s"} confirmed by telemetry`,
      delta: Math.min(0.3, 0.1 * conditions.length),
    },
  ];
  if (extraction.rejectionQuote) {
    factors.push({ label: "Expert said why the runbook action fails", delta: 0.05 });
  }
  if (contradicted > 0) {
    factors.push({
      label: `${contradicted} claim${contradicted === 1 ? "" : "s"} contradicted by telemetry, not learned`,
      delta: -0.1 * contradicted,
    });
  }
  if (unverifiable > 0) {
    factors.push({
      label: `${unverifiable} claim${unverifiable === 1 ? "" : "s"} could not be checked (telemetry missing), not learned`,
      delta: -0.1 * unverifiable,
    });
  }

  return {
    id: `RULE-${incident.id.replace("INC-", "")}`,
    version: 1,
    action: divergence.actual.action,
    overAction: divergence.expected.action,
    conditions,
    guardrails,
    evidence,
    confidence: computeConfidence(factors),
    sourceIncidentId: incident.id,
    history: [
      {
        version: 1,
        summary: `Learned from the expert's explanation on ${incident.id}`,
      },
    ],
    changedIds: [...conditions.map((c) => c.id), ...guardrails.map((g) => g.id)],
  };
}

export function conditionLabel(cond: RuleCondition): string {
  return cond.anyOf
    .map((id) => (cond.expected === "present" ? SIGNALS[id].label : `NOT ${SIGNALS[id].label.toLowerCase()}`))
    .join(" OR ");
}

export function ruleSentence(rule: DecisionRule): string {
  const when = rule.conditions.map(conditionLabel).join(" AND ");
  return `IF ${when} THEN ${ACTIONS[rule.action].label} over ${ACTIONS[rule.overAction].label}`;
}

export function evidenceFor(rule: DecisionRule, ids: string[]): Evidence[] {
  const wanted = new Set(ids);
  return rule.evidence.filter((e) => wanted.has(e.id));
}
