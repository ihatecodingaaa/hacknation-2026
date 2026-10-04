import { describe, expect, it } from "vitest";
import { extractExplanation } from "@/domain/extraction";
import { EXPERT_INCIDENT } from "@/domain/scenarios";
import { verifySemanticCandidates, type SemanticCandidates } from "@/domain/semantic";
import { chooseAction, startSession, submitExplanation } from "@/domain/session";
import { deriveSignals, signalState } from "@/domain/signals";
import { clauseAround, quoteSupportsSignal } from "@/domain/support";

// Gate 2 of verification: the expert's words must support the proposed signal
// on their own. Telemetry agreement never rescues words that do not.

const signals = deriveSignals(EXPERT_INCIDENT);
const supports = (signal: Parameters<typeof quoteSupportsSignal>[0], text: string, claimed: "present" | "absent" = "present") =>
  quoteSupportsSignal(signal, claimed, text).supported;

function verify(transcript: string, over: Partial<SemanticCandidates>) {
  return verifySemanticCandidates({
    transcript,
    signals,
    expectedAction: "restart_service",
    label: "test",
    candidates: { observations: [], causalClaims: [], rejectedAlternative: null, decisionRationale: "", uncertainty: [], ...over },
  });
}

// Scribe's transcription from a real microphone run: "failure" was heard as "video".
const MISHEARD = "The video started right after the deployment of it and only the new version is affected.";

describe("quoteSupportsSignal: failure began right after a deploy", () => {
  it.each([
    "The failure started right after the deployment",
    "The errors started immediately after the release",
    "The deployment caused the incident",
    "5xx spiked right after the v2.14 rollout",
    "It broke right after the deploy",
  ])("supports: %s", (text) => {
    expect(supports("deploy_preceded_failure", text)).toBe(true);
  });

  it.each([
    ["The video started right after the deployment", "not that anything failed"],
    ["The deployment finished eight minutes ago", "not that anything failed"],
    ["It started just after we deployed", "not that anything failed"],
    ["The failures are only on the new version", "in time or cause"],
    ["The failures started before the deployment", "before the deploy"],
  ])("does not support: %s", (text, why) => {
    const r = quoteSupportsSignal("deploy_preceded_failure", "present", text);
    expect(r.supported).toBe(false);
    expect(r.supported ? "" : r.reason).toContain(why);
  });
});

describe("quoteSupportsSignal: the other signals", () => {
  it("new version only needs isolation, not just a mention of a new version", () => {
    expect(supports("new_version_only", "Only the new version is affected")).toBe(true);
    expect(supports("new_version_only", "the old version is healthy")).toBe(true);
    expect(supports("new_version_only", "it's isolated to the new pods")).toBe(true);
    expect(supports("new_version_only", "only the canary is failing")).toBe(true);
    expect(supports("new_version_only", "We deployed the new version")).toBe(false);
    expect(supports("new_version_only", "we just deployed the new version")).toBe(false);
  });

  it("all versions affected needs global scope and failure", () => {
    expect(supports("all_versions_affected", "All versions are failing")).toBe(true);
    expect(supports("all_versions_affected", "both releases are affected")).toBe(true);
    expect(supports("all_versions_affected", "old and new pods are broken")).toBe(true);
    expect(supports("all_versions_affected", "all versions were deployed")).toBe(false);
  });

  it("error spike needs an error concept that is not described as normal", () => {
    expect(supports("error_spike", "the failures")).toBe(true);
    expect(supports("error_spike", "5xx went through the roof")).toBe(true);
    expect(supports("error_spike", "the deployment finished")).toBe(false);
  });

  it("latency, CPU and database need the concept and an abnormal state", () => {
    expect(supports("latency_up", "latency went way up")).toBe(true);
    expect(supports("latency_up", "response times were slow")).toBe(true);
    expect(supports("latency_up", "we looked at latency")).toBe(false);
    expect(supports("cpu_saturated", "CPU was pegged")).toBe(true);
    expect(supports("cpu_saturated", "we checked the CPU")).toBe(false);
    expect(supports("db_degraded", "the database was down")).toBe(true);
    expect(supports("db_degraded", "we checked the database")).toBe(false);
  });

  it("absence claims need the concept plus a normal state or a negation", () => {
    expect(supports("cpu_saturated", "CPU is fine", "absent")).toBe(true);
    expect(supports("db_degraded", "not the database", "absent")).toBe(true);
    expect(supports("deploy_preceded_failure", "nothing was deployed", "absent")).toBe(true);
    expect(supports("cpu_saturated", "CPU", "absent")).toBe(false);
  });
});

describe("negation is never flipped", () => {
  it('"the error rate stayed normal" is never positive error-spike evidence', () => {
    expect(supports("error_spike", "The error rate stayed normal")).toBe(false);
    expect(supports("error_spike", "The error rate stayed normal", "absent")).toBe(true);
    const x = extractExplanation("The error rate stayed normal.", signals, "restart_service");
    expect(x.citations).toEqual([expect.objectContaining({ signal: "error_spike", claimed: "absent" })]);
  });

  it("negated words do not support a positive claim", () => {
    expect(supports("error_spike", "the errors were not spiking")).toBe(false);
    expect(supports("deploy_preceded_failure", "the deploy did not cause the failure")).toBe(false);
  });

  it("a model quote that drops the 'not' is still refused at provenance", () => {
    const x = verify("The errors were not spiking.", {
      observations: [{ text: "The errors were spiking", candidateSignal: "error_spike", polarity: "present", confidence: 0.9 }],
    });
    expect(x.citations).toEqual([]);
    expect(x.rejected[0]).toMatchObject({ reason: "not_in_transcript" });
  });
});

describe("the live mishearing", () => {
  it("telemetry agreeing does not rescue words that do not support the claim", () => {
    // The world really does show a failure right after a deploy...
    expect(signalState(signals, "deploy_preceded_failure")).toBe("present");
    // ...but the expert's words, as transcribed, do not say so.
    const x = verify(MISHEARD, {
      observations: [
        { text: "The video started right after the deployment", candidateSignal: "deploy_preceded_failure", polarity: "present", confidence: 0.9 },
        { text: "only the new version is affected", candidateSignal: "new_version_only", polarity: "present", confidence: 0.9 },
      ],
    });
    expect(x.rejected).toEqual([
      expect.objectContaining({
        text: "The video started right after the deployment",
        signal: "deploy_preceded_failure",
        reason: "unsupported",
        detail: "The words say something happened around a deploy, not that anything failed",
      }),
    ]);
    expect(x.citations.map((c) => [c.signal, c.grounded])).toEqual([["new_version_only", true]]);
  });

  it("the correctly heard sentence is supported and learned", () => {
    const x = verify(MISHEARD.replace("video", "failure"), {
      observations: [
        { text: "The failure started right after the deployment", candidateSignal: "deploy_preceded_failure", polarity: "present", confidence: 0.9 },
      ],
    });
    expect(x.rejected).toEqual([]);
    expect(x.citations).toEqual([expect.objectContaining({ signal: "deploy_preceded_failure", grounded: true })]);
  });

  it("a causal claim on the misheard words is rejected", () => {
    const x = verify(MISHEARD, {
      causalClaims: [{ text: "The video started right after the deployment", cause: "deploy_preceded_failure", effect: "the incident" }],
    });
    expect(x.causal).toEqual([]);
    expect(x.citations).toEqual([]);
    expect(x.rejected[0]).toMatchObject({ reason: "unsupported", signal: "deploy_preceded_failure" });
  });

  it("a causal claim on words that do say it is learned", () => {
    const x = verify("The failures started right after the deployment.", {
      causalClaims: [{ text: "The failures started right after the deployment", cause: "deploy_preceded_failure", effect: "the failures" }],
    });
    expect(x.causal[0]).toMatchObject({ cause: "deploy_preceded_failure", consistent: true });
    expect(x.citations).toEqual([expect.objectContaining({ signal: "deploy_preceded_failure", grounded: true })]);
  });

  it("the phrase matcher fallback refuses the misheard timing claim too", () => {
    const x = extractExplanation(MISHEARD, signals, "restart_service");
    expect(x.citations.map((c) => c.signal)).toEqual(["new_version_only"]);
    expect(x.rejected).toEqual([expect.objectContaining({ signal: "deploy_preceded_failure", reason: "unsupported" })]);
  });

  it("through the session, rule v1 is built only from what the words support", () => {
    let s = chooseAction(startSession(EXPERT_INCIDENT), "rollback_deploy");
    s = submitExplanation(s, MISHEARD, "elevenlabs_live", {
      ok: true,
      label: "ElevenLabs Agents (text-only)",
      candidates: {
        observations: [
          { text: "The video started right after the deployment", candidateSignal: "deploy_preceded_failure", polarity: "present", confidence: 0.95 },
          { text: "only the new version is affected", candidateSignal: "new_version_only", polarity: "present", confidence: 0.95 },
        ],
        causalClaims: [{ text: "The video started right after the deployment", cause: "deploy_preceded_failure", effect: "the incident" }],
        rejectedAlternative: null,
        decisionRationale: "The failure began right after the deploy and only the new version is affected.",
        uncertainty: [],
      },
    });
    expect(s.ruleV1?.conditions.map((c) => c.id)).toEqual(["c-new_version_only"]);
    expect(s.ruleV1?.evidence[0]).toMatchObject({ text: MISHEARD, source: "elevenlabs_live" });
  });
});

describe("hedges and speech noise", () => {
  it("hedged words stay blocked even when the words and telemetry would support the claim", () => {
    const text = "Maybe the failures started after the deployment.";
    expect(supports("deploy_preceded_failure", text)).toBe(true);
    const x = verify(text, {
      observations: [
        { text: "Maybe the failures started after the deployment", candidateSignal: "deploy_preceded_failure", polarity: "present", confidence: 0.9 },
      ],
    });
    expect(x.citations).toEqual([]);
    expect(x.rejected[0]).toMatchObject({ reason: "hedged" });
  });

  it("repeated and cut-off words are fine when the meaningful words support the claim", () => {
    const noisy = "Uh, the the failures, uh, started right after the de- the deployment.";
    const x = verify(noisy, {
      observations: [
        { text: "the failures started right after the deployment", candidateSignal: "deploy_preceded_failure", polarity: "present", confidence: 0.9 },
      ],
    });
    expect(x.citations).toEqual([expect.objectContaining({ signal: "deploy_preceded_failure", grounded: true })]);
    expect(noisy).toContain(x.citations[0].quote);
  });

  it("support is read within the quote's own clause, not a neighbouring one", () => {
    const t = "The video started right after the deployment and the failures are only on the new version.";
    const span = { start: t.indexOf("right after"), end: t.indexOf("deployment") + "deployment".length };
    expect(clauseAround(t, span)).toBe("The video started right after the deployment ");
    expect(supports("deploy_preceded_failure", clauseAround(t, span))).toBe(false);
  });
});
