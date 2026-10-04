import { describe, expect, it } from "vitest";
import { extractExplanation } from "@/domain/extraction";
import { EXPERT_INCIDENT, SCRIPTED } from "@/domain/scenarios";
import {
  extractWithAttempt,
  parseSemanticOutput,
  verifySemanticCandidates,
  type SemanticCandidates,
} from "@/domain/semantic";
import { chooseAction, startSession, submitExplanation } from "@/domain/session";
import { deriveSignals } from "@/domain/signals";
import { locateQuote, normalizeSpeech } from "@/domain/speech";

const signals = deriveSignals(EXPERT_INCIDENT);

// Transcripts captured from real microphone runs through Scribe v2 Realtime.
const LIVE_ANSWER =
  "The failure started right after the deployment and only the new version is affected. Restarting won't just restart the bad version.";
const NOISY_ANSWER = "I rolled back because that, that the de- the deployment caused the accident, the incident.";

function candidates(over: Partial<SemanticCandidates> = {}): SemanticCandidates {
  return {
    observations: [],
    causalClaims: [],
    rejectedAlternative: null,
    decisionRationale: "",
    uncertainty: [],
    ...over,
  };
}

describe("speech normalization", () => {
  it("removes fillers, cut-off words and repeats but maps back to the original", () => {
    const n = normalizeSpeech(NOISY_ANSWER);
    expect(n.text).toBe("I rolled back because that the deployment caused the accident, the incident.");
    // "de-" and the first "the" were dropped; the surviving words keep their original positions.
    const at = n.text.indexOf("the deployment");
    expect(n.map[at]).toBe(NOISY_ANSWER.indexOf("the deployment"));
    expect(n.map[0]).toBe(0);
  });

  it("leaves clean text untouched", () => {
    expect(normalizeSpeech(SCRIPTED.explanation).text).toBe(SCRIPTED.explanation);
  });
});

describe("quote location", () => {
  it("finds a cleaned-up quote inside a disfluent transcript and returns the original words", () => {
    const span = locateQuote(NOISY_ANSWER, "the deployment caused the incident");
    expect(span).not.toBeNull();
    // The expert's exact words, including the self-correction the model smoothed over.
    expect(NOISY_ANSWER.slice(span!.start, span!.end)).toBe("the deployment caused the accident, the incident");
  });

  it("refuses a quote the expert never said", () => {
    expect(locateQuote(LIVE_ANSWER, "the database primary was overloaded")).toBeNull();
  });
});

describe("deterministic extraction on real transcripts", () => {
  it("grounds the live microphone answer", () => {
    const x = extractExplanation(LIVE_ANSWER, signals, "restart_service");
    expect(x.status).toBe("grounded");
    expect(x.citations.filter((c) => c.grounded).map((c) => c.signal)).toEqual([
      "error_spike",
      "deploy_preceded_failure",
      "new_version_only",
    ]);
    expect(x.extractor.kind).toBe("pattern");
  });

  it("matches through disfluency and quotes the original span", () => {
    const x = extractExplanation(NOISY_ANSWER, signals, "restart_service");
    const deploy = x.citations.find((c) => c.signal === "deploy_preceded_failure");
    expect(deploy?.grounded).toBe(true);
    expect(NOISY_ANSWER.slice(deploy!.start, deploy!.end)).toBe(deploy!.quote);
  });
});

describe("semantic output parsing", () => {
  const valid = candidates({
    observations: [{ text: "only the new version is affected", candidateSignal: "new_version_only", polarity: "present", confidence: 0.9 }],
  });

  it("accepts valid JSON wrapped in prose or a code fence", () => {
    const r = parseSemanticOutput("Here you go:\n```json\n" + JSON.stringify(valid) + "\n```");
    expect(r.ok).toBe(true);
  });

  it.each([
    ["not JSON at all", "I think they rolled back because of the deploy."],
    ["broken JSON", '{"observations": [}'],
    ["a signal outside the vocabulary", JSON.stringify(candidates({ observations: [{ text: "x", candidateSignal: "memory_leak" as never, polarity: "present", confidence: 1 }] }))],
    ["a confidence outside 0..1", JSON.stringify(candidates({ observations: [{ text: "x", candidateSignal: "error_spike", polarity: "present", confidence: 7 }] }))],
    ["a missing field", JSON.stringify({ observations: [] })],
  ])("rejects %s", (_name, raw) => {
    const r = parseSemanticOutput(raw);
    expect(r.ok).toBe(false);
  });
});

describe("deterministic verification of model claims", () => {
  it("learns only claims that are quoted, observable, confident and supported", () => {
    const x = verifySemanticCandidates({
      transcript: LIVE_ANSWER,
      signals,
      expectedAction: "restart_service",
      label: "test model",
      candidates: candidates({
        observations: [
          { text: "The failure started right after the deployment", candidateSignal: "deploy_preceded_failure", polarity: "present", confidence: 0.95 },
          { text: "only the new version is affected", candidateSignal: "new_version_only", polarity: "present", confidence: 0.9 },
          // Supported by telemetry but invented: not in the transcript.
          { text: "the error rate jumped to ten percent", candidateSignal: "error_spike", polarity: "present", confidence: 0.9 },
          // In the transcript but contradicted by telemetry (CPU is 41%).
          { text: "the bad version", candidateSignal: "cpu_saturated", polarity: "present", confidence: 0.8 },
        ],
        rejectedAlternative: { action: "restart_service", text: "Restarting won't just restart the bad version", reason: "restart keeps the bad build" },
        decisionRationale: "Bad deploy isolated to the new version, so roll back rather than restart.",
      }),
    });
    expect(x.extractor).toEqual({ kind: "semantic", label: "test model" });
    expect(x.status).toBe("grounded");
    const learned = x.citations.filter((c) => c.grounded).map((c) => c.signal);
    expect(learned).toEqual(["deploy_preceded_failure", "new_version_only"]);
    expect(x.citations.find((c) => c.signal === "cpu_saturated")).toMatchObject({ grounded: false, observed: "absent" });
    expect(x.rejected).toEqual([
      expect.objectContaining({ signal: "error_spike", reason: "not_in_transcript" }),
    ]);
    expect(x.rejectionQuote).toBe("Restarting won't just restart the bad version");
    expect(x.interpretation).toContain("Bad deploy");
    expect(x.patternCrossCheck).toEqual(["error_spike", "deploy_preceded_failure", "new_version_only"]);
  });

  it("does not learn unmapped, hedged or low-confidence claims", () => {
    const transcript = "Maybe the database was slow, and the logs showed a null pointer after the deploy.";
    const x = verifySemanticCandidates({
      transcript,
      signals,
      expectedAction: "restart_service",
      label: "test model",
      candidates: candidates({
        observations: [
          { text: "Maybe the database was slow", candidateSignal: "db_degraded", polarity: "unknown", confidence: 0.6 },
          { text: "the logs showed a null pointer", candidateSignal: "unmapped", polarity: "present", confidence: 0.9, note: "application logs" },
          { text: "after the deploy", candidateSignal: "deploy_preceded_failure", polarity: "present", confidence: 0.3 },
        ],
        uncertainty: ["unsure whether the database was involved"],
      }),
    });
    expect(x.citations).toEqual([]);
    expect(x.status).toBe("ungrounded");
    expect(x.rejected.map((r) => r.reason)).toEqual(["hedged", "not_observable", "low_confidence"]);
    expect(x.uncertainty).toEqual(["unsure whether the database was involved"]);
  });

  it("checks a causal claim against its precondition and learns the cause", () => {
    const x = verifySemanticCandidates({
      transcript: NOISY_ANSWER,
      signals,
      expectedAction: "restart_service",
      label: "test model",
      candidates: candidates({
        causalClaims: [{ text: "the deployment caused the incident", cause: "deploy_preceded_failure", effect: "the incident" }],
      }),
    });
    expect(x.causal[0]).toMatchObject({ cause: "deploy_preceded_failure", consistent: true });
    expect(x.causal[0].quote).toBe("the deployment caused the accident, the incident");
    expect(NOISY_ANSWER).toContain(x.causal[0].quote);
    expect(x.citations.map((c) => [c.signal, c.grounded])).toEqual([["deploy_preceded_failure", true]]);
  });
});

describe("fallback", () => {
  it("uses the phrase matcher and records why when the semantic call failed", () => {
    const x = extractWithAttempt(SCRIPTED.explanation, signals, "restart_service", {
      ok: false,
      label: "ElevenLabs agent",
      reason: "timed out",
    });
    expect(x.extractor.kind).toBe("pattern");
    expect(x.extractor.fallbackReason).toBe("ElevenLabs agent: timed out");
    expect(x.status).toBe("grounded");
  });

  it("falls back when a semantic payload is malformed instead of trusting it", () => {
    const x = extractWithAttempt(SCRIPTED.explanation, signals, "restart_service", {
      ok: true,
      label: "ElevenLabs agent",
      candidates: { observations: "everything" } as never,
    });
    expect(x.extractor.kind).toBe("pattern");
    expect(x.extractor.fallbackReason).toMatch(/schema validation/);
  });

  it("produces the same rule v1 through the session with no semantic provider", () => {
    let s = chooseAction(startSession(EXPERT_INCIDENT), "rollback_deploy");
    s = submitExplanation(s, SCRIPTED.explanation, "scripted", null);
    expect(s.ruleV1?.conditions.map((c) => c.id)).toEqual(["c-deploy_preceded_failure", "c-error_spike", "c-new_version_only"]);
  });

  it("builds a rule from verified semantic claims only", () => {
    let s = chooseAction(startSession(EXPERT_INCIDENT), "rollback_deploy");
    s = submitExplanation(s, NOISY_ANSWER, "elevenlabs_live", {
      ok: true,
      label: "ElevenLabs agent",
      candidates: candidates({
        observations: [{ text: "the database was down", candidateSignal: "db_degraded", polarity: "present", confidence: 0.9 }],
        causalClaims: [{ text: "the deployment caused the incident", cause: "deploy_preceded_failure", effect: "incident" }],
      }),
    });
    expect(s.extraction?.extractor.kind).toBe("semantic");
    expect(s.ruleV1?.conditions.map((c) => c.id)).toEqual(["c-deploy_preceded_failure"]);
    expect(s.ruleV1?.evidence[0]).toMatchObject({ text: NOISY_ANSWER, source: "elevenlabs_live" });
  });
});
