import { applyCounterfactual, generateCounterfactual, interpretAnswer } from "./counterfactual";
import { detectDivergence } from "./divergence";
import { extractExplanation } from "./extraction";
import { expectedAction } from "./playbook";
import { buildRule } from "./rules";
import { deriveSignals } from "./signals";
import type {
  ActionId,
  CounterfactualAnswer,
  CounterfactualQuestion,
  CounterfactualStance,
  DecisionDivergence,
  DecisionRule,
  ExpectedAction,
  ExpertExplanation,
  Extraction,
  IncidentSignal,
  IncidentState,
  TranscriptSource,
} from "./types";

// The expert half of the demo as a sequence of pure state transitions.
// The UI calls these; tests call the same functions.

export interface CounterfactualDraft {
  text: string;
  source: TranscriptSource;
  stance: CounterfactualStance | null;
  alternative: ActionId | null;
}

export interface ExpertSession {
  incident: IncidentState;
  signals: IncidentSignal[];
  expected: ExpectedAction;
  chosen: ActionId | null;
  divergence: DecisionDivergence | null;
  explanation: ExpertExplanation | null;
  extraction: Extraction | null;
  ruleV1: DecisionRule | null;
  counterfactual: CounterfactualQuestion | null;
  draft: CounterfactualDraft | null;
  answer: CounterfactualAnswer | null;
  /** Latest rule version. */
  rule: DecisionRule | null;
}

export function startSession(incident: IncidentState): ExpertSession {
  const signals = deriveSignals(incident);
  return {
    incident,
    signals,
    expected: expectedAction(signals),
    chosen: null,
    divergence: null,
    explanation: null,
    extraction: null,
    ruleV1: null,
    counterfactual: null,
    draft: null,
    answer: null,
    rule: null,
  };
}

export function chooseAction(s: ExpertSession, action: ActionId): ExpertSession {
  const fresh = startSession(s.incident);
  return {
    ...fresh,
    chosen: action,
    divergence: detectDivergence(s.signals, s.expected, { action, incidentId: s.incident.id }),
  };
}

export function submitExplanation(s: ExpertSession, text: string, source: TranscriptSource): ExpertSession {
  if (!s.divergence) return s;
  const explanation = { text, source };
  const extraction = extractExplanation(text, s.signals, s.expected.action);
  const ruleV1 = buildRule({
    incident: s.incident,
    signals: s.signals,
    divergence: s.divergence,
    explanation,
    extraction,
  });
  return {
    ...s,
    explanation,
    extraction,
    ruleV1,
    rule: ruleV1,
    counterfactual: ruleV1 ? generateCounterfactual(ruleV1, s.signals) : null,
    draft: null,
    answer: null,
  };
}

/** Clear an explanation that could not be grounded so the expert can try again. */
export function retryExplanation(s: ExpertSession): ExpertSession {
  return { ...s, explanation: null, extraction: null, ruleV1: null, rule: null, counterfactual: null, draft: null, answer: null };
}

export function submitCounterfactualAnswer(s: ExpertSession, text: string, source: TranscriptSource): ExpertSession {
  if (!s.ruleV1 || !s.counterfactual) return s;
  const draft = interpretAnswer(text, source, s.ruleV1.action);
  if (!draft.stance) return { ...s, draft, answer: null, rule: s.ruleV1 };
  return resolveStance({ ...s, draft }, draft.stance, draft.alternative);
}

/** Apply (or re-apply with a correction) the expert's stance. Always from v1. */
export function resolveStance(
  s: ExpertSession,
  stance: CounterfactualStance,
  alternative: ActionId | null,
): ExpertSession {
  if (!s.ruleV1 || !s.counterfactual || !s.draft) return s;
  const answer: CounterfactualAnswer = {
    text: s.draft.text,
    source: s.draft.source,
    stance,
    alternative: stance === "switch" ? alternative : null,
  };
  return {
    ...s,
    draft: { ...s.draft, stance, alternative: answer.alternative },
    answer,
    rule: applyCounterfactual(s.ruleV1, s.counterfactual, answer),
  };
}
