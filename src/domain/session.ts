import { applyCounterfactual, generateCounterfactual, interpretAnswer, type AnswerReading } from "./counterfactual";
import { detectDivergence } from "./divergence";
import { expectedAction } from "./playbook";
import { buildRule } from "./rules";
import { extractWithAttempt, type SemanticAttempt } from "./semantic";
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

/** The draft reading of a counterfactual answer, before it changes the rule. */
export type CounterfactualDraft = AnswerReading;

/**
 * Only the scripted demo answer may update the rule without the expert
 * confirming the reading. Live voice can be misheard; typed text is read by
 * the same simple parser. Both wait for confirmation.
 */
export function needsConfirmation(source: TranscriptSource): boolean {
  return source !== "scripted";
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

/**
 * Learn from the expert's explanation. `semantic` is the result of the
 * optional model-based extraction (fetched by the UI before calling this);
 * null means it was not configured, and the phrase matcher is used.
 */
export function submitExplanation(
  s: ExpertSession,
  text: string,
  source: TranscriptSource,
  semantic: SemanticAttempt | null = null,
): ExpertSession {
  if (!s.divergence) return s;
  const explanation = { text, source };
  const extraction = extractWithAttempt(text, s.signals, s.expected.action, semantic);
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

/**
 * Record the counterfactual answer as a draft reading. The scripted demo
 * answer is applied straight away when the reading is complete; anything
 * else waits for confirmCounterfactual().
 */
export function submitCounterfactualAnswer(s: ExpertSession, text: string, source: TranscriptSource): ExpertSession {
  if (!s.ruleV1 || !s.counterfactual) return s;
  const draft = interpretAnswer(text, source, s.ruleV1.action);
  const pending = { ...s, draft, answer: null, rule: s.ruleV1 };
  const complete = draft.stance === "still" || (draft.stance === "switch" && draft.alternative !== null);
  if (needsConfirmation(source) || !complete) return pending;
  return applyReading(pending, draft.stance!, draft.alternative, "scripted");
}

function applyReading(
  s: ExpertSession,
  stance: CounterfactualStance,
  alternative: ActionId | null,
  confirmedBy: CounterfactualAnswer["confirmedBy"],
): ExpertSession {
  if (!s.ruleV1 || !s.counterfactual || !s.draft) return s;
  // Never an actionless "no": the expert has to say what they would do instead.
  if (stance === "switch" && !alternative) return s;
  const answer: CounterfactualAnswer = {
    text: s.draft.text,
    source: s.draft.source,
    stance,
    alternative: stance === "switch" ? alternative : null,
    confirmedBy,
  };
  return {
    ...s,
    draft: { ...s.draft, stance, alternative: answer.alternative },
    answer,
    rule: applyCounterfactual(s.ruleV1, s.counterfactual, answer),
  };
}

/**
 * The expert confirms (or corrects) the reading. Always applied from rule v1,
 * so a correction replaces the previous v2 instead of stacking on it.
 * A "switch" without an alternative is refused.
 */
export function confirmCounterfactual(
  s: ExpertSession,
  stance: CounterfactualStance,
  alternative: ActionId | null,
): ExpertSession {
  return applyReading(s, stance, alternative, "expert");
}

/** Kept for existing callers: resolving the stance is confirming it. */
export const resolveStance = confirmCounterfactual;

/** Undo a confirmed reading so the expert can correct it. Back to rule v1, the draft kept. */
export function reopenCounterfactual(s: ExpertSession): ExpertSession {
  if (!s.draft || !s.ruleV1) return s;
  return { ...s, answer: null, rule: s.ruleV1 };
}
