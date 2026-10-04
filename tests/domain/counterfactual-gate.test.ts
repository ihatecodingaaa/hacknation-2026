import { describe, expect, it } from "vitest";
import { BENCHMARK_CASES, RUNBOOK_POLICY, memoryPolicy, runBenchmark } from "@/domain/benchmark";
import { deriveBoundaryMap } from "@/domain/boundary";
import { applyCounterfactual } from "@/domain/counterfactual";
import { evaluateTrainee } from "@/domain/evaluation";
import { compileDecisionMemory } from "@/domain/memory";
import { EXPERT_INCIDENT, SCRIPTED } from "@/domain/scenarios";
import {
  chooseAction,
  confirmCounterfactual,
  reopenCounterfactual,
  startSession,
  submitCounterfactualAnswer,
  submitExplanation,
  type ExpertSession,
} from "@/domain/session";
import { learnFromHero, traineeCase } from "./helpers";

// A real Scribe transcript of the counterfactual answer, badly misheard.
const GARBLED =
  "No. Intensive work because students who do this don't enough evidence out there. Not enough evidence that the department caused the incident.";

function atCounterfactual(explanation = SCRIPTED.explanation): ExpertSession {
  let s = chooseAction(startSession(EXPERT_INCIDENT), "rollback_deploy");
  s = submitExplanation(s, explanation, "elevenlabs_live");
  if (!s.ruleV1 || !s.counterfactual) throw new Error("expected rule v1 and a counterfactual");
  return s;
}

describe("counterfactual answers are drafts until the expert confirms", () => {
  it("a garbled live transcript starting with 'No' does not update the rule", () => {
    const s = submitCounterfactualAnswer(atCounterfactual(), GARBLED, "elevenlabs_live");
    expect(s.answer).toBeNull();
    expect(s.rule?.version).toBe(1);
    expect(s.rule?.guardrails).toEqual([]);
    // The draft keeps the original words and shows what it was read from.
    expect(s.draft).toMatchObject({ text: GARBLED, source: "elevenlabs_live", stance: "switch", alternative: null });
    expect(s.draft?.cues.stance).toBe("No");
    expect(s.draft?.concerns).toEqual([
      'The stance rests on a single word ("No"). Speech recognition can mishear the rest.',
      "No alternative action was named. Pick what the expert would do instead.",
    ]);
  });

  it("confirming 'no' without an alternative is refused: no actionless guardrail", () => {
    let s = submitCounterfactualAnswer(atCounterfactual(), GARBLED, "elevenlabs_live");
    s = confirmCounterfactual(s, "switch", null);
    expect(s.answer).toBeNull();
    expect(s.rule?.version).toBe(1);
    s = confirmCounterfactual(s, "switch", "investigate");
    expect(s.rule?.version).toBe(2);
    expect(s.answer).toMatchObject({ text: GARBLED, confirmedBy: "expert", alternative: "investigate" });
  });

  it("live 'No, I would investigate' waits for confirmation, then adds the investigate guardrail", () => {
    let s = submitCounterfactualAnswer(atCounterfactual(), "No, I would investigate.", "elevenlabs_live");
    expect(s.answer).toBeNull();
    expect(s.rule?.version).toBe(1);
    expect(s.draft).toMatchObject({ stance: "switch", alternative: "investigate" });
    expect(s.draft?.cues.alternative).toBe("investigate");
    s = confirmCounterfactual(s, s.draft!.stance!, s.draft!.alternative);
    expect(s.rule?.version).toBe(2);
    const g = s.rule?.guardrails.find((x) => x.origin === "counterfactual");
    expect(g?.insteadAction).toBe("investigate");
    // The original transcript is kept as evidence, with the confirmed reading beside it.
    const ev = s.rule?.evidence.find((e) => e.kind === "counterfactual");
    expect(ev?.text).toContain("A: No, I would investigate.");
    expect(ev?.text).toContain("(confirmed by the expert)");
  });

  it("typed answers use the same gate", () => {
    const s = submitCounterfactualAnswer(atCounterfactual(), "No, I would investigate.", "typed");
    expect(s.answer).toBeNull();
    expect(s.rule?.version).toBe(1);
  });

  it("a confirmed reading can be reopened and corrected, always from v1", () => {
    let s = submitCounterfactualAnswer(atCounterfactual(), "No, I would investigate.", "elevenlabs_live");
    s = confirmCounterfactual(s, "switch", "investigate");
    s = reopenCounterfactual(s);
    expect(s.answer).toBeNull();
    expect(s.rule?.version).toBe(1);
    s = confirmCounterfactual(s, "still", null);
    expect(s.rule?.version).toBe(2);
    expect(s.rule?.guardrails).toEqual([]);
    expect(s.rule?.conditions.find((c) => c.id === "c-error_spike")?.necessity).toBe("broadened");
    // And flipped straight back.
    s = confirmCounterfactual(s, "switch", "restart_service");
    expect(s.rule?.guardrails.map((g) => g.insteadAction)).toEqual(["restart_service"]);
  });

  it("the scripted demo answer is still applied in one step, and says so", () => {
    const { v2, session } = learnFromHero();
    expect(v2.version).toBe(2);
    expect(session.answer?.confirmedBy).toBe("scripted");
    expect(v2.evidence.find((e) => e.kind === "counterfactual")?.text).toContain("scripted demo answer, applied as written");
  });

  it("a scripted 'No.' with no alternative is not applied either", () => {
    const s = submitCounterfactualAnswer(atCounterfactual(), "No.", "scripted");
    expect(s.answer).toBeNull();
    expect(s.rule?.version).toBe(1);
  });

  it("the rule engine itself refuses an actionless switch", () => {
    const s = atCounterfactual();
    const same = applyCounterfactual(s.ruleV1!, s.counterfactual!, {
      text: "No.",
      source: "typed",
      stance: "switch",
      alternative: null,
      confirmedBy: "expert",
    });
    expect(same).toBe(s.ruleV1);
  });
});

describe("the counterfactual visibly moves the boundary", () => {
  // The expert names deploy timing and version scope only. The counterfactual then
  // probes version scope: "If the failures weren't isolated to the new version...".
  const EXPLANATION = "It started right after the deployment and only the new version is affected.";

  function scopeStory() {
    const s0 = atCounterfactual(EXPLANATION);
    const s1 = submitCounterfactualAnswer(s0, "No, I would investigate.", "elevenlabs_live");
    const s2 = confirmCounterfactual(s1, s1.draft!.stance!, s1.draft!.alternative);
    return { s0, s1, s2 };
  }

  it("rule v1 states 'only the new version is failing' without boundary-testing it", () => {
    const { s0 } = scopeStory();
    expect(s0.ruleV1?.conditions.map((c) => [c.id, c.necessity])).toEqual([
      ["c-deploy_preceded_failure", "stated"],
      ["c-new_version_only", "stated"],
    ]);
    expect(s0.counterfactual?.pivot).toBe("new_version_only");
    expect(s0.counterfactual?.question).toBe("If the failures weren't isolated to the new version, would you still roll back?");
  });

  it("before the counterfactual, flipping it leaves the rule silent", () => {
    const { s0 } = scopeStory();
    const map = deriveBoundaryMap(s0.ruleV1!, s0.signals);
    const cell = map.axes.find((a) => a.conditionId === "c-new_version_only")!.flipped;
    expect(cell.outcome).toEqual({ kind: "silent" });
  });

  it("a pending answer changes nothing on the map", () => {
    const { s1 } = scopeStory();
    expect(s1.rule).toBe(s1.ruleV1);
  });

  it("after confirmation, v2 tests the condition and adds an explicit guardrail", () => {
    const { s2 } = scopeStory();
    expect(s2.rule?.conditions.find((c) => c.id === "c-new_version_only")).toMatchObject({ necessity: "confirmed", testedIn: 2 });
    expect(s2.rule?.guardrails).toEqual([
      expect.objectContaining({
        id: "g-cf-new_version_only",
        origin: "counterfactual",
        introducedIn: 2,
        insteadAction: "investigate",
        trigger: [
          { signal: "new_version_only", state: "absent" },
          { signal: "deploy_preceded_failure", state: "present" },
        ],
      }),
    ]);
  });

  it("the map reports the move, computed by the rule engine: silent in v1, investigate in v2", () => {
    const { s2 } = scopeStory();
    const map = deriveBoundaryMap(s2.rule!, s2.signals, s2.ruleV1);
    const axis = map.axes.find((a) => a.conditionId === "c-new_version_only")!;
    expect(axis.necessity).toBe("confirmed");
    expect(axis.flipped.before).toEqual({ kind: "silent" });
    expect(axis.flipped.outcome).toMatchObject({ kind: "instead", action: "investigate", origin: "counterfactual", introducedIn: 2 });
    // Only the probed condition moved.
    const moved = map.axes.filter((a) => a.flipped.before || a.missing.before).map((a) => a.conditionId);
    expect(moved).toEqual(["c-new_version_only"]);
  });

  it("the hero story's error-rate cell moves the same way", () => {
    const { v1, v2, signals } = learnFromHero();
    const axis = deriveBoundaryMap(v2, signals, v1).axes.find((a) => a.conditionId === "c-error_spike")!;
    expect(axis.flipped.before).toEqual({ kind: "silent" });
    expect(axis.flipped.outcome).toMatchObject({ kind: "instead", action: "investigate" });
  });

  it("trainee case B then gets the expert's alternative", () => {
    const { s2 } = scopeStory();
    const r = evaluateTrainee(s2.rule!, traineeCase("B"), "rollback_deploy");
    expect(r.verdict).toBe("mismatch");
    expect(r.match.recommended).toBe("investigate");
    expect(r.provenance.some((e) => e.kind === "counterfactual")).toBe(true);
  });

  it("the benchmark runs on this rule too, from the compiled artifact", () => {
    const { s2 } = scopeStory();
    const [runbook, v1, v2] = runBenchmark(BENCHMARK_CASES, [
      RUNBOOK_POLICY,
      memoryPolicy(compileDecisionMemory(s2.ruleV1!), "v1"),
      memoryPolicy(compileDecisionMemory(s2.rule!), "v2"),
    ]);
    for (const r of [runbook, v1, v2]) {
      expect(r.totals.correct + r.totals.incorrect + r.totals.abstained).toBe(14);
    }
    expect(v2.totals.correct).toBeGreaterThan(v1.totals.correct);
  });
});
