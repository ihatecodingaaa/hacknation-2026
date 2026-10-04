import { describe, expect, it } from "vitest";
import {
  BENCHMARK_CASES,
  RUNBOOK_POLICY,
  gradeDecision,
  memoryPolicy,
  runBenchmark,
} from "@/domain/benchmark";
import { matchRule } from "@/domain/evaluation";
import {
  compileDecisionMemory,
  executeDecisionMemory,
  parseDecisionMemory,
  renderAgentContext,
  serializeDecisionMemory,
} from "@/domain/memory";
import { EXPERT_INCIDENT, TRAINEE_CASES } from "@/domain/scenarios";
import { deriveSignals } from "@/domain/signals";
import type { DecisionRule, IncidentState } from "@/domain/types";
import { learnFromHero } from "./helpers";

const { v1, v2 } = learnFromHero();
const { v2: broadened } = learnFromHero({ answer: "Yes, I'd still roll back." });

const ALL_INCIDENTS: IncidentState[] = [EXPERT_INCIDENT, ...TRAINEE_CASES.map((c) => c.incident), ...BENCHMARK_CASES.map((c) => c.incident)];

function roundTrip(rule: DecisionRule) {
  const parsed = parseDecisionMemory(serializeDecisionMemory(compileDecisionMemory(rule)));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

describe("decision memory artifact", () => {
  it("survives serialization and validates against its schema", () => {
    const memory = compileDecisionMemory(v2);
    expect(roundTrip(v2)).toEqual(memory);
    expect(memory).toMatchObject({
      schema: "secondshift.decision-memory/v1",
      ruleId: "RULE-2041",
      version: 2,
      decision: { action: "rollback_deploy", insteadOf: "restart_service" },
      fallback: { missingEvidence: "abstain", noMatch: "defer_to_runbook", standDown: "defer_to_runbook" },
      evidenceStrength: { kind: "heuristic", score: 0.85, cap: 0.85 },
    });
    expect(memory.conditions.find((c) => c.id === "c-error_spike")).toMatchObject({ status: "boundary_tested", testedIn: 2 });
    expect(memory.guardrails.at(-1)).toMatchObject({ then: { kind: "do_instead", action: "investigate" }, origin: "counterfactual" });
    expect(memory.provenance.some((p) => p.kind === "counterfactual")).toBe(true);
    expect(memory.signalDefinitions.error_spike.measuredAs).toBe("5xx rate >= max(2%, 3x baseline)");
  });

  it("rejects a tampered or malformed artifact", () => {
    const json = JSON.parse(serializeDecisionMemory(compileDecisionMemory(v2)));
    json.conditions[0].anyOf = ["gut_feeling"];
    expect(parseDecisionMemory(JSON.stringify(json)).ok).toBe(false);
    expect(parseDecisionMemory("{").ok).toBe(false);
    expect(parseDecisionMemory(JSON.stringify({ ...json, schema: "other/v9" })).ok).toBe(false);
  });

  it.each([
    ["v1", v1],
    ["v2", v2],
    ["broadened v2", broadened],
  ])("the artifact alone reproduces the rule engine on every seeded incident (%s)", (_name, rule) => {
    const memory = roundTrip(rule);
    for (const incident of ALL_INCIDENTS) {
      const signals = deriveSignals(incident);
      const m = matchRule(rule, signals);
      const d = executeDecisionMemory(memory, signals);
      const expected =
        m.outcome === "applies" || (m.outcome === "guardrail" && m.recommended)
          ? { kind: "act", action: m.recommended }
          : m.outcome === "uncertain"
            ? { kind: "abstain" }
            : { kind: "defer_to_runbook" };
      expect(d, incident.id).toMatchObject(expected);
    }
  });

  it("renders agent context from the artifact, guardrails first", () => {
    const text = renderAgentContext(roundTrip(v2));
    expect(text).toContain("Decision memory RULE-2041 v2");
    expect(text).toContain("(heuristic, capped at 0.85)");
    expect(text.indexOf("Check these first")).toBeLessThan(text.indexOf("Otherwise, when ALL"));
    expect(text).toContain(
      "If latency increased and the error rate stayed normal and the failure started right after a deploy: hold and investigate.",
    );
    expect(text).toContain('expert: "only the new version"');
    expect(text).toContain("do not act on this rule. Get the evidence first.");
  });
});

describe("seeded benchmark", () => {
  it("has 14 distinct cases, each with a ground truth and a reason", () => {
    expect(BENCHMARK_CASES).toHaveLength(14);
    expect(new Set(BENCHMARK_CASES.map((c) => c.id)).size).toBe(14);
    for (const c of BENCHMARK_CASES) expect(c.truth.why.length).toBeGreaterThan(10);
  });

  it("grades decisions: abstaining is only correct when the evidence is missing", () => {
    const missing = BENCHMARK_CASES.find((c) => c.truth.correct === "abstain")!;
    const rollback = BENCHMARK_CASES.find((c) => c.truth.correct === "rollback_deploy")!;
    const upstream = BENCHMARK_CASES.find((c) => c.id === "BM-07")!;
    expect(gradeDecision(missing, { kind: "abstain", note: "" }).grade).toBe("correct");
    expect(gradeDecision(rollback, { kind: "abstain", note: "" }).grade).toBe("abstained");
    expect(gradeDecision(rollback, { kind: "act", action: "restart_service", note: "" }).grade).toBe("incorrect");
    expect(gradeDecision(upstream, { kind: "act", action: "rollback_deploy", note: "" })).toEqual({ grade: "incorrect", harmful: true });
  });

  it("totals are counted from the rows", () => {
    const [runbook, mem] = runBenchmark(BENCHMARK_CASES, [RUNBOOK_POLICY, memoryPolicy(roundTrip(v2), "v2")]);
    for (const r of [runbook, mem]) {
      expect(r.totals.correct + r.totals.incorrect + r.totals.abstained).toBe(r.totals.total);
      expect(r.totals.correct).toBe(r.rows.filter((x) => x.grade === "correct").length);
    }
    // The runbook can never abstain.
    expect(runbook.totals.abstained).toBe(0);
  });

  it("runbook vs learned memory, before and after the counterfactual", () => {
    const [runbook, mv1, mv2] = runBenchmark(BENCHMARK_CASES, [
      RUNBOOK_POLICY,
      memoryPolicy(roundTrip(v1), "v1"),
      memoryPolicy(roundTrip(v2), "v2"),
    ]);
    expect(runbook.totals).toEqual({ total: 14, correct: 5, incorrect: 9, abstained: 0, harmful: 0 });
    expect(mv1.totals).toEqual({ total: 14, correct: 10, incorrect: 3, abstained: 1, harmful: 0 });
    expect(mv2.totals).toEqual({ total: 14, correct: 11, incorrect: 2, abstained: 1, harmful: 0 });
    // The case the counterfactual fixed:
    const fixed = mv2.rows.filter((r, i) => r.grade === "correct" && mv1.rows[i].grade !== "correct").map((r) => r.caseId);
    expect(fixed).toEqual(["BM-08"]);
    // Honest misses stay visible.
    expect(mv2.rows.filter((r) => r.grade === "incorrect").map((r) => r.caseId)).toEqual(["BM-06", "BM-07"]);
  });
});
