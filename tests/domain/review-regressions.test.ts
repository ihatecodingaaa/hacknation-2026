import { describe, expect, it } from "vitest";
import { matchRule } from "@/domain/evaluation";
import { extractExplanation } from "@/domain/extraction";
import { compileDecisionMemory, executeDecisionMemory } from "@/domain/memory";
import { EXPERT_INCIDENT } from "@/domain/scenarios";
import { verifySemanticCandidates, type SemanticCandidates } from "@/domain/semantic";
import { deriveSignals } from "@/domain/signals";
import { locateQuote } from "@/domain/speech";
import { learnFromHero } from "./helpers";

// Regressions for issues found in an adversarial review of the verification layer.

const signals = deriveSignals(EXPERT_INCIDENT);

function verify(transcript: string, over: Partial<SemanticCandidates>) {
  return verifySemanticCandidates({
    transcript,
    signals,
    expectedAction: "restart_service",
    label: "test",
    candidates: { observations: [], causalClaims: [], rejectedAlternative: null, decisionRationale: "", uncertainty: [], ...over },
  });
}

describe("hedged words never become conditions", () => {
  it("a causal claim on a hedged clause is rejected, even if the model did not flag it", () => {
    const x = verify("I think maybe the deploy caused the outage, I'm not sure.", {
      causalClaims: [{ text: "maybe the deploy caused the outage", cause: "deploy_preceded_failure", effect: "the incident" }],
    });
    expect(x.citations).toEqual([]);
    expect(x.status).toBe("ungrounded");
    expect(x.rejected[0]).toMatchObject({ reason: "hedged" });
  });

  it("a causal claim on words the model itself rejected as unsure is not learned", () => {
    const x = verify("The deploy caused the outage, I'm fairly sure.", {
      observations: [{ text: "The deploy caused the outage", candidateSignal: "deploy_preceded_failure", polarity: "present", confidence: 0.2 }],
      causalClaims: [{ text: "The deploy caused the outage", cause: "deploy_preceded_failure", effect: "the outage" }],
    });
    expect(x.citations).toEqual([]);
    expect(x.rejected.map((r) => r.reason)).toEqual(["low_confidence", "low_confidence"]);
  });

  it("the phrase matcher shows hedged phrases but does not learn them", () => {
    const x = extractExplanation("The failures started right after the deployment. Maybe the database was slow.", signals, "restart_service");
    expect(x.citations.map((c) => c.signal)).toEqual(["error_spike", "deploy_preceded_failure"]);
    expect(x.rejected).toEqual([expect.objectContaining({ signal: "db_degraded", reason: "hedged" })]);
  });

  it('"I think" alone is not a hedge', () => {
    const x = extractExplanation("I think only the new version is failing.", signals, "restart_service");
    expect(x.citations.map((c) => c.signal)).toContain("new_version_only");
  });
});

describe("quote tracing never adds or drops a negation", () => {
  const transcript = "Honestly the deploy did not cause this, the errors were not spiking either.";

  it.each([
    ["the deploy did cause this"],
    ["the errors were spiking"],
    ["cause this"],
  ])("rejects %s", (quote) => {
    expect(locateQuote(transcript, quote)).toBeNull();
  });

  it("rejects a quote that inserts a negation", () => {
    expect(locateQuote("the errors were normal and fine", "the errors were not normal")).toBeNull();
  });

  it("still accepts the faithful negated quote", () => {
    const span = locateQuote(transcript, "the errors were not spiking");
    expect(transcript.slice(span!.start, span!.end)).toBe("the errors were not spiking");
  });

  it("a model claim built on a dropped 'not' is not learned", () => {
    const x = verify(transcript, {
      observations: [{ text: "the errors were spiking", candidateSignal: "error_spike", polarity: "present", confidence: 0.9 }],
      causalClaims: [{ text: "the deploy did cause this", cause: "deploy_preceded_failure", effect: "this" }],
    });
    expect(x.citations).toEqual([]);
    expect(x.rejected.every((r) => r.reason === "not_in_transcript")).toBe(true);
  });
});

describe("cleaning speech never flips a claim", () => {
  it('"normal-" is not treated as a cut-off word', () => {
    const x = extractExplanation("The errors were normal- only the new version is failing.", signals, "restart_service");
    const errors = x.citations.find((c) => c.signal === "error_spike");
    expect(errors?.claimed).not.toBe("present");
  });

  it('a real cut-off ("de- the deployment") is still cleaned', () => {
    const x = extractExplanation("It broke right after the de- the deployment.", signals, "restart_service");
    expect(x.citations.find((c) => c.signal === "deploy_preceded_failure")?.grounded).toBe(true);
  });
});

describe("rules always rest on evidence", () => {
  it('"yes, still" on the only condition keeps it instead of producing an empty rule', () => {
    const { v2 } = learnFromHero({ explanation: "It broke right after the deploy.", answer: "Yes, I'd still roll back." });
    expect(v2.conditions.map((c) => c.id)).toEqual(["c-deploy_preceded_failure"]);
    expect(v2.confidence.score).toBeLessThan(0.65);
    expect(executeDecisionMemory(compileDecisionMemory(v2), {}).kind).toBe("abstain");
  });

  it("dropping a condition leaves no policy behind for it", () => {
    const { v2 } = learnFromHero({
      explanation: "It broke right after the deploy and only the new version is affected.",
      answer: "Yes, I'd still roll back.",
    });
    expect(v2.conditions.map((c) => c.id)).toEqual(["c-deploy_preceded_failure"]);
    expect(v2.guardrails).toEqual([]);
  });

  it("an empty rule never applies, in either engine", () => {
    const { v2 } = learnFromHero();
    const empty = { ...v2, conditions: [], guardrails: [] };
    expect(matchRule(empty, signals).outcome).toBe("not_applicable");
    expect(executeDecisionMemory(compileDecisionMemory(empty), signals).kind).toBe("defer_to_runbook");
  });
});

describe("the rejected alternative must be the runbook action", () => {
  it("ignores a model-proposed rejection about a different action", () => {
    const x = verify("Scaling out would not help. Only the new version is failing.", {
      rejectedAlternative: { action: "scale_out", text: "Scaling out would not help", reason: "" },
    });
    expect(x.rejectionQuote).toBeNull();
    expect(x.rejected).toEqual([expect.objectContaining({ reason: "off_topic" })]);
  });
});
