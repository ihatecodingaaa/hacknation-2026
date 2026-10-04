import { z } from "zod";
import { ACTIONS, ACTION_ORDER } from "./actions";
import { extractExplanation, findRejection } from "./extraction";
import { SIGNAL_ORDER, signalState } from "./signals";
import { isHedged, locateQuote } from "./speech";
import type {
  ActionId,
  CausalCheck,
  Citation,
  Extraction,
  IncidentSignal,
  RejectedCandidate,
  SignalId,
} from "./types";

// Semantic candidate extraction.
//
// A language model reads the expert's answer and PROPOSES claims: what they
// observed, what they think caused it, which alternative they rejected. It is
// shown the signal vocabulary but not the telemetry, so it cannot fit claims
// to the data. This module then DECIDES what can be trusted, with plain code:
//
//   1. the output must match a strict schema, or it is discarded;
//   2. every claim must quote words that are really in the transcript;
//   3. it must name an observable signal, stated without hedging;
//   4. the telemetry must agree with it.
//
// Only claims that pass all four become rule conditions.

const SIGNAL_OR_UNMAPPED = z.enum(["unmapped", ...SIGNAL_ORDER] as const);
const ACTION = z.enum(ACTION_ORDER as [ActionId, ...ActionId[]]);
const QUOTE = z.string().trim().min(1).max(300);

export const SemanticCandidatesSchema = z.object({
  observations: z
    .array(
      z.object({
        /** Verbatim words from the transcript. */
        text: QUOTE,
        candidateSignal: SIGNAL_OR_UNMAPPED,
        polarity: z.enum(["present", "absent", "unknown"]),
        confidence: z.number().min(0).max(1),
        /** For "unmapped": what the expert referred to. */
        note: z.string().max(200).optional(),
      }),
    )
    .max(12),
  causalClaims: z
    .array(
      z.object({
        text: QUOTE,
        cause: SIGNAL_OR_UNMAPPED,
        effect: z.string().max(200),
      }),
    )
    .max(6),
  rejectedAlternative: z
    .object({
      action: ACTION.nullable(),
      text: QUOTE,
      reason: z.string().max(300),
    })
    .nullable(),
  decisionRationale: z.string().max(400),
  uncertainty: z.array(z.string().max(200)).max(6),
});

export type SemanticCandidates = z.infer<typeof SemanticCandidatesSchema>;

/** Below this self-reported confidence a proposed mapping is not learned. */
export const MIN_CANDIDATE_CONFIDENCE = 0.5;

export type ParseResult = { ok: true; value: SemanticCandidates } | { ok: false; error: string };

/**
 * Turn raw model output into validated candidates. Tolerates a code fence or
 * prose around the JSON object; anything that does not match the schema
 * exactly is rejected with a short reason.
 */
export function parseSemanticOutput(raw: unknown): ParseResult {
  let value: unknown = raw;
  if (typeof raw === "string") {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end <= start) return { ok: false, error: "No JSON object in model output" };
    try {
      value = JSON.parse(raw.slice(start, end + 1));
    } catch {
      return { ok: false, error: "Model output is not valid JSON" };
    }
  }
  const parsed = SemanticCandidatesSchema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return { ok: false, error: `Model output failed schema validation (${issues})` };
  }
  return { ok: true, value: parsed.data };
}

export interface VerifyInput {
  transcript: string;
  candidates: SemanticCandidates;
  signals: IncidentSignal[];
  expectedAction: ActionId;
  label: string;
}

/** Deterministic verification of model-proposed claims. Produces the same Extraction the rule builder uses. */
export function verifySemanticCandidates(input: VerifyInput): Extraction {
  const { transcript, candidates, signals, expectedAction, label } = input;
  const citations: Citation[] = [];
  const rejected: RejectedCandidate[] = [];
  const cited = new Set<string>();

  function cite(signal: SignalId, claimed: "present" | "absent", span: { start: number; end: number }) {
    const key = `${signal}:${claimed}`;
    if (cited.has(key)) return;
    cited.add(key);
    const observed = signalState(signals, signal);
    citations.push({
      signal,
      claimed,
      observed,
      quote: transcript.slice(span.start, span.end),
      ...span,
      grounded: observed === claimed,
    });
  }

  // Hedging is decided by code as well: a hedge word in the clause, or a place
  // the extractor itself flagged as uncertain, blocks every claim there.
  const unsure = candidates.uncertainty.map((u) => locateQuote(transcript, u)).filter((x) => x !== null);
  const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;
  function hedgeAt(span: { start: number; end: number }): string | null {
    const word = isHedged(transcript, span);
    if (word) return `Hedged in the transcript ("${word}")`;
    return unsure.some((u) => overlaps(u, span)) ? "The extractor marked this as uncertain" : null;
  }
  const blocked: { start: number; end: number; reason: RejectedCandidate["reason"]; detail: string }[] = [];

  for (const o of candidates.observations) {
    const span = locateQuote(transcript, o.text);
    const signal = o.candidateSignal === "unmapped" ? null : o.candidateSignal;
    const hedge = span ? hedgeAt(span) : null;
    if (!span) {
      rejected.push({ text: o.text, signal, reason: "not_in_transcript", detail: "Quoted words are not in the transcript" });
    } else if (!signal) {
      rejected.push({
        text: transcript.slice(span.start, span.end),
        signal: null,
        reason: "not_observable",
        detail: o.note ? `Refers to ${o.note}, which this incident's telemetry does not measure` : "Not an observable signal",
      });
    } else if (o.polarity === "unknown" || hedge) {
      const detail = hedge ?? "The expert was unsure";
      rejected.push({ text: transcript.slice(span.start, span.end), signal, reason: "hedged", detail });
      blocked.push({ ...span, reason: "hedged", detail });
    } else if (o.confidence < MIN_CANDIDATE_CONFIDENCE) {
      const detail = `Extractor confidence ${o.confidence.toFixed(2)} is below ${MIN_CANDIDATE_CONFIDENCE}`;
      rejected.push({ text: transcript.slice(span.start, span.end), signal, reason: "low_confidence", detail });
      blocked.push({ ...span, reason: "low_confidence", detail });
    } else {
      cite(signal, o.polarity, span);
    }
  }

  const causal: CausalCheck[] = [];
  for (const c of candidates.causalClaims) {
    const span = locateQuote(transcript, c.text);
    const cause = c.cause === "unmapped" ? null : c.cause;
    if (!span) {
      rejected.push({ text: c.text, signal: cause, reason: "not_in_transcript", detail: "Quoted words are not in the transcript" });
      continue;
    }
    // The same gates as observations: a causal claim on hedged or doubted words is not learned.
    const hedge = hedgeAt(span);
    const block = blocked.find((b) => overlaps(b, span));
    if (hedge || block) {
      rejected.push({
        text: transcript.slice(span.start, span.end),
        signal: cause,
        reason: hedge ? "hedged" : block!.reason,
        detail: hedge ?? block!.detail,
      });
      continue;
    }
    const state = cause ? signalState(signals, cause) : "unknown";
    causal.push({
      quote: transcript.slice(span.start, span.end),
      ...span,
      cause,
      effect: c.effect,
      consistent: state === "unknown" ? "unknown" : state === "present",
    });
    // A causal claim rests on its cause being present. That is a claim too.
    if (cause) cite(cause, "present", span);
  }

  let rejectionQuote: string | null = null;
  const alt = candidates.rejectedAlternative;
  if (alt) {
    const span = locateQuote(transcript, alt.text);
    const words = span ? transcript.slice(span.start, span.end) : null;
    if (!span || !words) {
      rejected.push({ text: alt.text, signal: null, reason: "not_in_transcript", detail: "Quoted words are not in the transcript" });
    } else if ((alt.action && alt.action !== expectedAction) || !ACTIONS[expectedAction].keywords.test(words)) {
      // It must be about the runbook action the expert actually rejected.
      rejected.push({
        text: words,
        signal: null,
        reason: "off_topic",
        detail: `Does not say why ${ACTIONS[expectedAction].label.toLowerCase()} is wrong`,
      });
    } else {
      rejectionQuote = words;
    }
  }

  citations.sort((a, b) => a.start - b.start);
  const grounded = citations.some((c) => c.grounded && c.claimed === "present");
  const reference = extractExplanation(transcript, signals, expectedAction);

  return {
    citations,
    rejectionQuote: rejectionQuote ?? findRejection(transcript, expectedAction),
    status: grounded ? "grounded" : "ungrounded",
    extractor: { kind: "semantic", label },
    rejected,
    causal,
    interpretation: candidates.decisionRationale.trim() || null,
    uncertainty: candidates.uncertainty,
    patternCrossCheck: [...new Set(reference.citations.filter((c) => c.grounded).map((c) => c.signal))],
  };
}

/** What the browser gets back from /api/reasoning/extract. */
export type SemanticAttempt =
  | { ok: true; label: string; candidates: SemanticCandidates }
  | { ok: false; label: string; reason: string };

/** Use the semantic candidates when they arrived, otherwise fall back to the phrase matcher and say why. */
export function extractWithAttempt(
  transcript: string,
  signals: IncidentSignal[],
  expectedAction: ActionId,
  attempt: SemanticAttempt | null,
): Extraction {
  if (attempt?.ok) {
    const checked = parseSemanticOutput(attempt.candidates);
    if (checked.ok) {
      return verifySemanticCandidates({ transcript, candidates: checked.value, signals, expectedAction, label: attempt.label });
    }
    attempt = { ok: false, label: attempt.label, reason: checked.error };
  }
  const x = extractExplanation(transcript, signals, expectedAction);
  if (attempt && !attempt.ok) x.extractor = { ...x.extractor, fallbackReason: `${attempt.label}: ${attempt.reason}` };
  return x;
}
