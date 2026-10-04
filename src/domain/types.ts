// Core domain model for SecondShift.
// Everything here is plain data so the judgment logic stays testable and exact.

export type ActionId =
  | "restart_service"
  | "rollback_deploy"
  | "scale_out"
  | "failover_db"
  | "investigate";

export interface Action {
  id: ActionId;
  label: string;
  /** Used inside generated sentences: "would you still {verb}?" */
  verb: string;
  /** "You {past} instead of {gerund}." */
  past: string;
  gerund: string;
  /** Words that identify this action in spoken or typed answers. */
  keywords: RegExp;
}

export type SignalId =
  | "deploy_preceded_failure"
  | "error_spike"
  | "new_version_only"
  | "all_versions_affected"
  | "latency_up"
  | "cpu_saturated"
  | "db_degraded";

export type SignalCategory = "change" | "symptom" | "scope" | "resource";

/** A signal is never guessed: missing telemetry makes it unknown. */
export type SignalState = "present" | "absent" | "unknown";

export interface IncidentSignal {
  id: SignalId;
  state: SignalState;
  /** Human readable measurement that produced the state. */
  detail: string;
}

export interface VersionStats {
  version: string;
  isNew: boolean;
  instances: number;
  errorRatePct: number;
}

export interface TimelineEvent {
  /** Minutes before "now" (positive = in the past). */
  minutesAgo: number;
  kind: "deploy" | "alert" | "metric" | "note";
  text: string;
}

/** Raw telemetry for one incident. Signals are derived from this by code. */
export interface IncidentState {
  id: string;
  title: string;
  service: string;
  severity: "SEV1" | "SEV2" | "SEV3";
  /** Wall clock label for "now", only for display. */
  clock: string;
  deploy: {
    version: string;
    previousVersion: string;
    completedMinutesAgo: number;
    rolloutPct: number;
  } | null;
  /** When errors or latency first left baseline. null = no degradation. */
  degradationOnsetMinutesAgo: number | null;
  errorRatePct: { baseline: number; current: number };
  p99LatencyMs: { baseline: number; current: number };
  cpuPct: number;
  dbHealthy: boolean;
  /** Per-version breakdown. null = not available (labels missing). */
  versions: VersionStats[] | null;
  /** Error rate samples, one per minute, oldest first, ending now. */
  errorSeries: number[];
  timeline: TimelineEvent[];
}

export interface PlaybookStep {
  id: string;
  when: string;
  action: ActionId;
  /** Fires when all of these signals are present. Empty = default step. */
  requires: SignalId[];
}

export interface ExpectedAction {
  action: ActionId;
  /** The playbook step that fired. */
  step: PlaybookStep;
  /** Signals the playbook looked at to make this call. */
  usedSignals: SignalId[];
}

export interface ExpertAction {
  action: ActionId;
  incidentId: string;
}

export interface DecisionDivergence {
  expected: ExpectedAction;
  actual: ExpertAction;
  /** Abnormal signals the playbook did not use: the likely hidden condition. */
  ignoredSignals: SignalId[];
  /** Why the system is interrupting the expert. */
  reason: string;
  question: string;
}

export type TranscriptSource =
  | "elevenlabs_live" // Scribe v2 Realtime transcript, unedited
  | "elevenlabs_edited" // Scribe transcript the expert corrected by hand
  | "typed"
  | "scripted"; // seeded demo answer, clearly labelled in the UI

export interface ExpertExplanation {
  text: string;
  source: TranscriptSource;
}

/** One place in the explanation that refers to a signal. */
export interface Citation {
  signal: SignalId;
  /** What the expert claimed about the signal. */
  claimed: "present" | "absent";
  /** What the telemetry says. */
  observed: SignalState;
  quote: string;
  start: number;
  end: number;
  grounded: boolean;
}

/** How a citation's claim compares with the telemetry. Only "supported" is learned. */
export type ClaimVerdict = "supported" | "contradicted" | "unverifiable";

/** Which extractor proposed the claims. Verification is the same for both. */
export interface ExtractorInfo {
  kind: "pattern" | "semantic";
  /** e.g. "ElevenLabs agent" or "Deterministic phrase matcher". */
  label: string;
  /** Set when a semantic extractor was attempted and could not be used. */
  fallbackReason?: string;
}

/** A model-proposed claim that never reached the telemetry check. */
export interface RejectedCandidate {
  text: string;
  signal: SignalId | null;
  reason: "not_in_transcript" | "not_observable" | "hedged" | "low_confidence" | "off_topic";
  detail: string;
}

/** A causal claim ("the deploy caused it") checked against its precondition. */
export interface CausalCheck {
  quote: string;
  start: number;
  end: number;
  cause: SignalId | null;
  effect: string;
  /** Does the telemetry show the cause it rests on? */
  consistent: boolean | "unknown";
}

export interface Extraction {
  citations: Citation[];
  /** Sentence where the expert says why the playbook action is wrong. */
  rejectionQuote: string | null;
  status: "grounded" | "ungrounded";
  extractor: ExtractorInfo;
  rejected: RejectedCandidate[];
  causal: CausalCheck[];
  /** Model-written restatement. Shown as interpretation, never used as evidence. */
  interpretation: string | null;
  /** Places where the expert said they were unsure. */
  uncertainty: string[];
  /** Semantic runs only: what the phrase matcher found on the same transcript. */
  patternCrossCheck: SignalId[] | null;
}

export type EvidenceKind = "expert_quote" | "signal" | "counterfactual";

export interface Evidence {
  id: string;
  kind: EvidenceKind;
  text: string;
  source: TranscriptSource | "telemetry";
  incidentId: string;
}

export interface RuleCondition {
  id: string;
  /** Satisfied when any of these signals is in the expected state. */
  anyOf: SignalId[];
  expected: "present" | "absent";
  necessity: "stated" | "confirmed" | "broadened";
  evidenceIds: string[];
  /** The expert's exact words that produced this condition. */
  quote: string | null;
  /** Rule version that introduced the condition. */
  introducedIn: number;
  /** Rule version whose counterfactual tested it, if any. */
  testedIn: number | null;
}

export interface Guardrail {
  id: string;
  description: string;
  /** All of these must hold for the guardrail to fire. */
  trigger: { signal: SignalId; state: "present" | "absent" }[];
  /** What to do instead when it fires. null = this rule gives no advice. */
  insteadAction: ActionId | null;
  origin: "derived" | "counterfactual";
  evidenceIds: string[];
  /** Rule version that introduced the guardrail. */
  introducedIn: number;
}

/**
 * Evidence strength factor. The score is a transparent heuristic (a sum of
 * visible factors), not a probability.
 */
export interface ConfidenceFactor {
  label: string;
  delta: number;
}

export interface Confidence {
  score: number;
  level: "low" | "medium" | "high";
  factors: ConfidenceFactor[];
  cap: number;
  capReason: string;
}

export interface RuleRevision {
  version: number;
  summary: string;
}

export interface DecisionRule {
  id: string;
  version: number;
  action: ActionId;
  overAction: ActionId;
  conditions: RuleCondition[];
  guardrails: Guardrail[];
  evidence: Evidence[];
  confidence: Confidence;
  sourceIncidentId: string;
  history: RuleRevision[];
  /** Ids of conditions / guardrails changed in the latest revision. */
  changedIds: string[];
}

export interface CounterfactualQuestion {
  /** The cited condition whose necessity is being tested. */
  pivot: SignalId;
  /** An observed but uncited signal kept present in the hypothetical. */
  confounder: SignalId | null;
  question: string;
  rationale: string;
  /** The hypothetical incident shown next to the question. */
  hypothetical: { signal: SignalId; from: SignalState; to: SignalState }[];
}

export type CounterfactualStance = "still" | "switch";

export interface CounterfactualAnswer {
  text: string;
  source: TranscriptSource;
  stance: CounterfactualStance;
  /** Action the expert would take instead, when stance is "switch". */
  alternative: ActionId | null;
  /** Who settled the reading: the expert confirmed it, or a scripted demo answer was applied as is. */
  confirmedBy: "expert" | "scripted";
}

export interface TraineeDecision {
  incidentId: string;
  action: ActionId;
}

export interface ConditionMatch {
  conditionId: string;
  anyOf: SignalId[];
  expected: "present" | "absent";
  observed: SignalState[];
  met: boolean | "unknown";
}

export interface RuleMatch {
  outcome: "applies" | "guardrail" | "uncertain" | "not_applicable";
  conditions: ConditionMatch[];
  firedGuardrail: Guardrail | null;
  /** What the learned rule recommends here. null = no recommendation. */
  recommended: ActionId | null;
}

export type Verdict = "aligned" | "mismatch" | "uncertain" | "outside_rule";

export interface EvaluationResult {
  verdict: Verdict;
  trainee: TraineeDecision;
  expected: ExpectedAction;
  match: RuleMatch;
  headline: string;
  explanation: string;
  /** Evidence from the original expert session that supports the verdict. */
  provenance: Evidence[];
}
