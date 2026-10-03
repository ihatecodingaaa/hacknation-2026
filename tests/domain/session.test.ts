import { describe, expect, it } from "vitest";
import { EXPERT_INCIDENT, SCRIPTED } from "@/domain/scenarios";
import {
  chooseAction,
  resolveStance,
  retryExplanation,
  startSession,
  submitCounterfactualAnswer,
  submitExplanation,
} from "@/domain/session";

describe("expert session", () => {
  it("does nothing to learn when the expert follows the runbook", () => {
    const s = chooseAction(startSession(EXPERT_INCIDENT), "restart_service");
    expect(s.divergence).toBeNull();
    expect(submitExplanation(s, SCRIPTED.explanation, "typed")).toBe(s);
  });

  it("changing the action discards everything learned downstream", () => {
    let s = chooseAction(startSession(EXPERT_INCIDENT), "rollback_deploy");
    s = submitExplanation(s, SCRIPTED.explanation, "typed");
    expect(s.rule).not.toBeNull();
    s = chooseAction(s, "scale_out");
    expect(s.rule).toBeNull();
    expect(s.explanation).toBeNull();
    expect(s.divergence?.actual.action).toBe("scale_out");
  });

  it("a vague answer produces no rule and can be retried", () => {
    let s = chooseAction(startSession(EXPERT_INCIDENT), "rollback_deploy");
    s = submitExplanation(s, SCRIPTED.vagueExplanation, "typed");
    expect(s.extraction?.status).toBe("ungrounded");
    expect(s.rule).toBeNull();
    expect(s.counterfactual).toBeNull();
    s = retryExplanation(s);
    expect(s.explanation).toBeNull();
    s = submitExplanation(s, SCRIPTED.explanation, "elevenlabs_live");
    expect(s.rule?.evidence[0].source).toBe("elevenlabs_live");
  });

  it("an unclear counterfactual answer waits for the expert to pick a stance", () => {
    let s = chooseAction(startSession(EXPERT_INCIDENT), "rollback_deploy");
    s = submitExplanation(s, SCRIPTED.explanation, "typed");
    s = submitCounterfactualAnswer(s, "Hmm, it depends.", "typed");
    expect(s.draft?.stance).toBeNull();
    expect(s.answer).toBeNull();
    expect(s.rule?.version).toBe(1);
    s = resolveStance(s, "switch", "investigate");
    expect(s.rule?.version).toBe(2);
    expect(s.rule?.guardrails.at(-1)?.insteadAction).toBe("investigate");
  });

  it("correcting a misread stance re-applies from v1, not on top of v2", () => {
    let s = chooseAction(startSession(EXPERT_INCIDENT), "rollback_deploy");
    s = submitExplanation(s, SCRIPTED.explanation, "typed");
    s = submitCounterfactualAnswer(s, SCRIPTED.counterfactualAnswer, "typed");
    expect(s.answer?.stance).toBe("switch");
    s = resolveStance(s, "still", null);
    expect(s.rule?.version).toBe(2);
    expect(s.rule?.guardrails.some((g) => g.origin === "counterfactual")).toBe(false);
    expect(s.rule?.conditions.find((c) => c.id === "c-error_spike")?.anyOf).toEqual(["error_spike", "latency_up"]);
  });
});
