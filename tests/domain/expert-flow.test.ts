import { describe, expect, it } from "vitest";
import { detectDivergence } from "@/domain/divergence";
import { extractExplanation } from "@/domain/extraction";
import { expectedAction } from "@/domain/playbook";
import { buildRule, ruleSentence } from "@/domain/rules";
import { EXPERT_INCIDENT, SCRIPTED } from "@/domain/scenarios";
import { deriveSignals } from "@/domain/signals";
import { learnFromHero } from "./helpers";

const signals = deriveSignals(EXPERT_INCIDENT);

describe("expected action", () => {
  it("follows the runbook: elevated 5xx means restart", () => {
    const expected = expectedAction(signals);
    expect(expected.action).toBe("restart_service");
    expect(expected.step.id).toBe("RB-3");
    expect(expected.usedSignals).toEqual(["error_spike"]);
  });

  it("prefers database failover when the database is degraded", () => {
    const s = deriveSignals({ ...EXPERT_INCIDENT, dbHealthy: false });
    expect(expectedAction(s).action).toBe("failover_db");
  });
});

describe("divergence detection", () => {
  const expected = expectedAction(signals);

  it("stays quiet when the expert follows the runbook", () => {
    expect(detectDivergence(signals, expected, { action: "restart_service", incidentId: "INC-2041" })).toBeNull();
  });

  it("flags rollback over restart and names what the runbook ignored", () => {
    const d = detectDivergence(signals, expected, { action: "rollback_deploy", incidentId: "INC-2041" });
    expect(d).not.toBeNull();
    expect(d!.ignoredSignals).toEqual(["deploy_preceded_failure", "latency_up", "new_version_only"]);
    expect(d!.question).toBe("You rolled back instead of restarting. What made you choose that?");
  });
});

describe("grounded extraction", () => {
  it("grounds the expert's explanation in observed signals", () => {
    const x = extractExplanation(SCRIPTED.explanation, signals, "restart_service");
    expect(x.status).toBe("grounded");
    expect(x.citations.map((c) => [c.signal, c.quote, c.grounded])).toEqual([
      ["error_spike", "failures", true],
      ["deploy_preceded_failure", "right after the deployment", true],
      ["new_version_only", "only the new version", true],
    ]);
    expect(x.rejectionQuote).toBe("Restarting would just restart the bad version.");
  });

  it.each([
    [
      "5xx spiked right after the v2.14 rollout and the old pods are fine.",
      ["error_spike", "deploy_preceded_failure", "new_version_only"],
    ],
    [
      "It started just after we deployed, only the canary is throwing errors.",
      ["deploy_preceded_failure", "new_version_only", "error_spike"],
    ],
    [
      "Errors lined up with the deploy. Database is healthy, CPU is fine.",
      ["error_spike", "deploy_preceded_failure", "db_degraded", "cpu_saturated"],
    ],
  ])("grounds spoken variants: %s", (text, expected) => {
    const x = extractExplanation(text, signals, "restart_service");
    expect(x.status).toBe("grounded");
    expect(x.citations.map((c) => c.signal)).toEqual(expected);
    expect(x.citations.every((c) => c.grounded)).toBe(true);
  });

  it("refuses to learn from a vague answer", () => {
    const x = extractExplanation(SCRIPTED.vagueExplanation, signals, "restart_service");
    expect(x.status).toBe("ungrounded");
    expect(x.citations).toHaveLength(0);
  });

  it("flags claims the telemetry contradicts", () => {
    const x = extractExplanation("The database was down after the deploy.", signals, "restart_service");
    const db = x.citations.find((c) => c.signal === "db_degraded");
    expect(db).toMatchObject({ claimed: "present", observed: "absent", grounded: false });
  });

  it("reads negations as absent, not present", () => {
    const x = extractExplanation("The error rate stayed normal and CPU is normal.", signals, "restart_service");
    expect(x.citations.map((c) => [c.signal, c.claimed])).toEqual([
      ["error_spike", "absent"],
      ["cpu_saturated", "absent"],
    ]);
    // error_spike is actually present, so that claim is wrong; CPU claim is right.
    expect(x.citations.map((c) => c.grounded)).toEqual([false, true]);
    // Only negative claims: nothing positive to act on, so no rule.
    expect(x.status).toBe("ungrounded");
  });
});

describe("rule v1", () => {
  it("builds IF/THEN with derived guardrails and visible confidence", () => {
    const { v1 } = learnFromHero();
    expect(ruleSentence(v1)).toBe(
      "IF Failure began right after a deploy AND Error rate spiked AND Only the new version is failing " +
        "THEN Roll back deployment over Restart service",
    );
    expect(v1.guardrails.map((g) => g.trigger)).toEqual([
      [{ signal: "deploy_preceded_failure", state: "absent" }],
      [{ signal: "all_versions_affected", state: "present" }],
    ]);
    expect(v1.confidence.score).toBe(0.65);
    expect(v1.confidence.level).toBe("medium");
    expect(v1.evidence[0]).toMatchObject({ kind: "expert_quote", text: SCRIPTED.explanation });
  });

  it("produces no rule when nothing grounds", () => {
    const expected = expectedAction(signals);
    const divergence = detectDivergence(signals, expected, { action: "rollback_deploy", incidentId: "INC-2041" })!;
    const explanation = { text: SCRIPTED.vagueExplanation, source: "typed" as const };
    const extraction = extractExplanation(explanation.text, signals, expected.action);
    expect(buildRule({ incident: EXPERT_INCIDENT, signals, divergence, explanation, extraction })).toBeNull();
  });

  it("lowers confidence for contradicted claims and does not learn them", () => {
    const { v1 } = learnFromHero({
      explanation: `${SCRIPTED.explanation} Also the database was down.`,
    });
    expect(v1.conditions.map((c) => c.id)).not.toContain("c-db_degraded");
    expect(v1.confidence.score).toBe(0.55);
  });
});
