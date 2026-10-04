import { describe, expect, it } from "vitest";
import { evaluateTrainee, matchRule } from "@/domain/evaluation";
import { SCRIPTED } from "@/domain/scenarios";
import { deriveSignals } from "@/domain/signals";
import { learnFromHero, traineeCase } from "./helpers";

const { v1, v2, incident: hero } = learnFromHero();

describe("rule matching", () => {
  it("applies to its own source incident", () => {
    expect(matchRule(v2, deriveSignals(hero)).outcome).toBe("applies");
  });

  it("never fires a guardrail on unknown data", () => {
    const m = matchRule(v2, deriveSignals(traineeCase("D")));
    expect(m.firedGuardrail).toBeNull();
    expect(m.outcome).toBe("uncertain");
  });
});

describe("trainee transfer", () => {
  it("A: catches the trainee who restarts a bad deploy", () => {
    const r = evaluateTrainee(v2, traineeCase("A"), "restart_service");
    expect(r.verdict).toBe("mismatch");
    expect(r.expected.action).toBe("restart_service");
    expect(r.match.recommended).toBe("rollback_deploy");
    expect(r.explanation).toContain("That is the runbook answer the expert rejected.");
    // Provenance goes back to the original expert words and source telemetry.
    expect(r.provenance.find((e) => e.kind === "expert_quote")?.text).toBe(SCRIPTED.explanation);
    expect(r.provenance.filter((e) => e.kind === "signal").every((e) => e.incidentId === "INC-2041")).toBe(true);
  });

  it("A: agrees with the trainee who rolls back", () => {
    expect(evaluateTrainee(v2, traineeCase("A"), "rollback_deploy").verdict).toBe("aligned");
  });

  it("B: when every version fails, the rule does not support rolling back", () => {
    const r = evaluateTrainee(v2, traineeCase("B"), "rollback_deploy");
    expect(r.verdict).toBe("outside_rule");
    expect(r.match.outcome).toBe("not_applicable");
    expect(r.match.firedGuardrail).toBeNull();
    expect(r.match.recommended).toBeNull();
    expect(r.headline).toBe("Roll back deployment is not supported by the expert's rule");
    expect(r.explanation).toContain("only the new version is failing");
  });

  it("B: does not grade choices the expert never taught", () => {
    expect(evaluateTrainee(v2, traineeCase("B"), "restart_service").verdict).toBe("outside_rule");
  });

  it("C: the counterfactual guardrail says investigate, not roll back", () => {
    const r = evaluateTrainee(v2, traineeCase("C"), "rollback_deploy");
    expect(r.verdict).toBe("mismatch");
    expect(r.match.recommended).toBe("investigate");
    expect(r.provenance.some((e) => e.kind === "counterfactual")).toBe(true);
    expect(evaluateTrainee(v2, traineeCase("C"), "investigate").verdict).toBe("aligned");
  });

  it("C: before the counterfactual, the rule simply does not cover it", () => {
    expect(evaluateTrainee(v1, traineeCase("C"), "rollback_deploy").verdict).toBe("outside_rule");
  });

  it("D: missing per-version data gives an uncertain verdict, not a guess", () => {
    for (const action of ["restart_service", "rollback_deploy"] as const) {
      const r = evaluateTrainee(v2, traineeCase("D"), action);
      expect(r.verdict).toBe("uncertain");
      expect(r.match.recommended).toBeNull();
      expect(r.explanation).toContain("only the new version is failing");
    }
  });
});
