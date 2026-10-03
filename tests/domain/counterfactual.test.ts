import { describe, expect, it } from "vitest";
import { classifyStance, detectAlternative } from "@/domain/counterfactual";
import { SCRIPTED } from "@/domain/scenarios";
import { learnFromHero } from "./helpers";

describe("counterfactual question", () => {
  it("probes the error-vs-latency boundary the expert left implicit", () => {
    const { cf } = learnFromHero();
    expect(cf.pivot).toBe("error_spike");
    expect(cf.confounder).toBe("latency_up");
    expect(cf.question).toBe("If latency increased but the error rate stayed normal, would you still roll back?");
    expect(cf.hypothetical).toEqual([
      { signal: "error_spike", from: "present", to: "absent" },
      { signal: "latency_up", from: "present", to: "present" },
    ]);
  });
});

describe("answer interpretation", () => {
  it.each([
    [SCRIPTED.counterfactualAnswer, "switch"],
    ["Nope, latency alone isn't enough.", "switch"],
    ["I wouldn't, I'd look at traces first.", "switch"],
    ["Yes, I'd still roll back.", "still"],
    ["I would still roll back, the deploy is the suspect either way.", "still"],
    ["Hmm, it depends on the service.", null],
  ])("%s -> %s", (text, stance) => {
    expect(classifyStance(text)).toBe(stance);
  });

  it("finds the alternative action in the answer", () => {
    expect(detectAlternative(SCRIPTED.counterfactualAnswer, "rollback_deploy")).toBe("investigate");
    expect(detectAlternative("No, I'd just restart it.", "rollback_deploy")).toBe("restart_service");
    expect(detectAlternative("No.", "rollback_deploy")).toBeNull();
  });
});

describe("rule update", () => {
  it('"no" confirms the condition and adds a guardrail with the alternative', () => {
    const { v1, v2 } = learnFromHero();
    expect(v2.version).toBe(2);
    expect(v2.conditions.find((c) => c.id === "c-error_spike")?.necessity).toBe("confirmed");
    const g = v2.guardrails.find((x) => x.origin === "counterfactual");
    expect(g).toMatchObject({
      trigger: [
        { signal: "latency_up", state: "present" },
        { signal: "error_spike", state: "absent" },
      ],
      insteadAction: "investigate",
    });
    expect(g?.description).toBe(
      "Latency increased but the error rate stayed normal: hold and investigate instead of rolling back.",
    );
    expect(v2.changedIds).toEqual(["c-error_spike", "g-cf-error_spike"]);
    expect(v2.confidence.score).toBeGreaterThan(v1.confidence.score);
    expect(v2.confidence.score).toBe(0.85);
    expect(v2.evidence.some((e) => e.kind === "counterfactual")).toBe(true);
  });

  it('"yes" broadens the condition instead', () => {
    const { v2 } = learnFromHero({ answer: "Yes, I'd still roll back." });
    const cond = v2.conditions.find((c) => c.id === "c-error_spike");
    expect(cond?.anyOf).toEqual(["error_spike", "latency_up"]);
    expect(cond?.necessity).toBe("broadened");
    expect(v2.guardrails.some((g) => g.origin === "counterfactual")).toBe(false);
  });

  it("never exceeds the single-incident confidence cap", () => {
    const { v2 } = learnFromHero();
    expect(v2.confidence.score).toBeLessThanOrEqual(v2.confidence.cap);
  });
});
