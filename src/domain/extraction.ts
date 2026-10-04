import { ACTIONS } from "./actions";
import { signalState } from "./signals";
import { isHedged, normalizeSpeech, toOriginalSpan } from "./speech";
import type {
  ActionId,
  Citation,
  ClaimVerdict,
  Extraction,
  IncidentSignal,
  RejectedCandidate,
  SignalId,
} from "./types";

// Deterministic extraction: the fallback when no semantic extractor is
// configured, and the regression reference when one is.
//
// The explanation is matched against a closed vocabulary of incident signals.
// Matching runs on a disfluency-cleaned copy of the transcript (see speech.ts);
// every span is mapped back so quotes are always the expert's exact words.
// A phrase only becomes a rule condition if the telemetry agrees with what the
// expert claimed. Anything the telemetry contradicts, or cannot confirm, is
// kept as a visible citation but not learned. If nothing grounds, there is
// no rule: SecondShift does not invent reasons the expert did not give.

interface Pattern {
  signal: SignalId;
  claimed: "present" | "absent";
  re: RegExp;
}

const DEPLOY = String.raw`(?:deploy(?:ment|ed)?|release[ds]?|rollout|push(?:ed)?|ship(?:ped)?)`;
const NORMAL = String.raw`(?:normal|fine|flat|ok|okay|low|clean|healthy|stable|good)`;
const IS = String.raw`(?:is|was|were|are|stayed|stays|remained|remains|looks?|looked|seems?|seemed)`;
/** Optional version token: "after the v2.14 rollout". */
const VERSION = String.raw`(?:v?\d[\w.]*\s+)?`;

function p(signal: SignalId, claimed: "present" | "absent", source: string): Pattern {
  return { signal, claimed, re: new RegExp(source, "gi") };
}

// Order matters: negations and specific phrases claim their span first so a
// generic word inside them ("error rate stayed normal") is not double counted.
const PATTERNS: Pattern[] = [
  // Explicit negations.
  p("deploy_preceded_failure", "absent", String.raw`\b(?:no|wasn'?t\s+a|without\s+a|there\s+was\s+no)\s+(?:recent\s+)?${DEPLOY}\b`),
  p("deploy_preceded_failure", "absent", String.raw`\bnothing\s+(?:was\s+|got\s+)?(?:deployed|shipped|released)\b`),
  p("deploy_preceded_failure", "absent", String.raw`\b(?:before|prior\s+to)\s+the\s+${DEPLOY}\b`),
  p("error_spike", "absent", String.raw`\b(?:error\s+rate|errors?|5xx|500s)\s+${IS}\s+(?:still\s+)?${NORMAL}\b`),
  p("error_spike", "absent", String.raw`\bno\s+(?:new\s+)?(?:errors|5xx|500s|error\s+spike|failures)\b`),
  p("latency_up", "absent", String.raw`\b(?:latency|response\s+times?|p99)\s+${IS}\s+(?:still\s+)?${NORMAL}\b`),
  p("new_version_only", "absent", String.raw`\bnot\s+(?:just|only)\s+(?:on\s+|in\s+)?(?:the\s+)?(?:new|canary|latest)\b`),
  p("cpu_saturated", "absent", String.raw`\b(?:cpu|load|capacity)\s+(?:${IS}\s+)?${NORMAL}\b`),
  p("cpu_saturated", "absent", String.raw`\bnot\s+(?:a\s+)?(?:cpu|capacity|load)\s+(?:issue|problem)\b`),
  p("db_degraded", "absent", String.raw`\b(?:database|db|postgres|mysql|primary)\s+(?:${IS}\s+)?${NORMAL}\b`),
  p("db_degraded", "absent", String.raw`\bnot\s+(?:the\s+|a\s+)?(?:database|db)\b`),

  // Specific positive phrases.
  p("deploy_preceded_failure", "present", String.raw`\b(?:right|just|immediately|straight|shortly|soon)\s+after\s+(?:the\s+|we\s+|our\s+|that\s+|this\s+)?(?:new\s+)?${VERSION}${DEPLOY}\b`),
  p("deploy_preceded_failure", "present", String.raw`\b(?:since|after|with)\s+(?:the|this|that|our)\s+(?:new\s+)?${VERSION}${DEPLOY}\b`),
  p("deploy_preceded_failure", "present", String.raw`\b${DEPLOY}\s+(?:caused|broke|triggered|introduced|started)\b`),
  p("deploy_preceded_failure", "present", String.raw`\b(?:line[sd]?\s+up|coincid\w*|correlat\w*|match(?:es|ed)?)\s+with\s+(?:the\s+)?${DEPLOY}\b`),
  p("new_version_only", "present", String.raw`\bonly\s+(?:on\s+|in\s+|affects?\s+|hitting\s+)?(?:the\s+)?(?:new|newer|newest|latest|canary|updated)\b(?:\s+(?:version|build|release|pods?|instances?|nodes?|hosts?|replicas?|code))?`),
  p("new_version_only", "present", String.raw`\b(?:new|latest|canary)\s+(?:version|build|release|pods?|instances?)\s+(?:only|alone)\b`),
  p("new_version_only", "present", String.raw`\b(?:old|previous|stable|prior|other)\s+(?:version|build|release|pods?|instances?)\s+${IS}\s+(?:fine|healthy|ok|okay|clean|good|normal|unaffected)\b`),
  p("new_version_only", "present", String.raw`\bisolated\s+to\s+(?:the\s+)?(?:new|canary|latest)\b`),
  p("all_versions_affected", "present", String.raw`\b(?:all|every|both)\s+(?:the\s+|of\s+the\s+)?(?:versions?|pods?|instances?|replicas?|nodes?)\b[^.!?]{0,25}?\b(?:fail\w*|affected|error\w*|broken|down)\b`),
  p("all_versions_affected", "present", String.raw`\b(?:old|previous|stable)\s+(?:version|build|pods?)\s+(?:is|was|are|were)\s+(?:also\s+)?(?:failing|affected|erroring|broken)\b`),
  p("cpu_saturated", "present", String.raw`\b(?:cpu|load)\s+(?:is\s+|was\s+)?(?:pegged|saturated|maxed|high|spiking)\b`),
  p("db_degraded", "present", String.raw`\b(?:database|db|postgres|mysql)\s+(?:is\s+|was\s+)?(?:down|degraded|slow|failing|struggling|overloaded|locked)\b`),

  // Generic symptom words, last.
  p("error_spike", "present", String.raw`\b(?:error\s+rate|errors?|5xx|500s|failures?|failing\s+requests|exceptions)\b`),
  p("latency_up", "present", String.raw`\b(?:latency|p99|response\s+times?|slow(?:er|ness|down)?)\b`),
];

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }) {
  return a.start < b.end && b.start < a.end;
}

export function findSentences(text: string): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  const re = /[^.!?]+[.!?]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (trimmed) {
      out.push({ text: trimmed, start: m.index + lead, end: m.index + lead + trimmed.length });
    }
  }
  return out;
}

export const PATTERN_EXTRACTOR = { kind: "pattern", label: "Deterministic phrase matcher" } as const;

export function citationVerdict(c: Pick<Citation, "claimed" | "observed">): ClaimVerdict {
  if (c.observed === c.claimed) return "supported";
  return c.observed === "unknown" ? "unverifiable" : "contradicted";
}

/** The sentence where the expert says why the runbook action is wrong. */
export function findRejection(text: string, expectedAction: ActionId): string | null {
  return findSentences(text).find((s) => ACTIONS[expectedAction].keywords.test(s.text))?.text ?? null;
}

export function extractExplanation(
  text: string,
  signals: IncidentSignal[],
  expectedAction: ActionId,
): Extraction {
  const norm = normalizeSpeech(text);
  const found: (Citation & { nStart: number; nEnd: number })[] = [];

  for (const pattern of PATTERNS) {
    pattern.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.re.exec(norm.text))) {
      const span = { start: m.index, end: m.index + m[0].length };
      if (m[0].length === 0) {
        pattern.re.lastIndex++;
        continue;
      }
      if (found.some((c) => overlaps({ start: c.nStart, end: c.nEnd }, span))) continue;
      const observed = signalState(signals, pattern.signal);
      const original = toOriginalSpan(norm, span.start, span.end);
      found.push({
        signal: pattern.signal,
        claimed: pattern.claimed,
        observed,
        quote: text.slice(original.start, original.end),
        ...original,
        grounded: observed === pattern.claimed,
        nStart: span.start,
        nEnd: span.end,
      });
    }
  }

  // A hedged phrase ("maybe the database was slow") is shown, not learned.
  const rejected: RejectedCandidate[] = [];
  const citations: Citation[] = found
    .sort((a, b) => a.start - b.start)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    .map(({ nStart, nEnd, ...c }) => c)
    .filter((c) => {
      const hedge = isHedged(text, c);
      if (!hedge) return true;
      rejected.push({ text: c.quote, signal: c.signal, reason: "hedged", detail: `Hedged in the transcript ("${hedge}")` });
      return false;
    });

  const grounded = citations.some((c) => c.grounded && c.claimed === "present");

  return {
    citations,
    rejectionQuote: findRejection(text, expectedAction),
    status: grounded ? "grounded" : "ungrounded",
    extractor: { ...PATTERN_EXTRACTOR },
    rejected,
    causal: [],
    interpretation: null,
    uncertainty: [],
    patternCrossCheck: null,
  };
}
