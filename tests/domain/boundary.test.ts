import { describe, expect, it } from "vitest";
import { deriveBoundaryMap, placeIncident } from "@/domain/boundary";
import { deriveSignals } from "@/domain/signals";
import { learnFromHero, traineeCase } from "./helpers";

const { v1, v2, signals } = learnFromHero();

function axis(map: ReturnType<typeof deriveBoundaryMap>, id: string) {
  const a = map.axes.find((x) => x.conditionId === id);
  if (!a) throw new Error(`no axis ${id}`);
  return a;
}

describe("decision boundary map", () => {
  const map = deriveBoundaryMap(v2, signals, v1);

  it("has one axis per learned condition, with the expert's words and versions", () => {
    expect(map.axes.map((a) => a.conditionId)).toEqual(["c-deploy_preceded_failure", "c-error_spike", "c-new_version_only"]);
    expect(axis(map, "c-new_version_only").quote).toBe("only the new version");
    expect(axis(map, "c-error_spike")).toMatchObject({ necessity: "confirmed", introducedIn: 1, testedIn: 2 });
    expect(axis(map, "c-deploy_preceded_failure")).toMatchObject({ necessity: "stated", testedIn: null });
    expect(map.inside).toEqual({ kind: "apply", action: "rollback_deploy" });
  });

  it("flipping the error spike lands on the counterfactual boundary: investigate", () => {
    const cell = axis(map, "c-error_spike").flipped;
    expect(cell.changes).toEqual([{ signal: "error_spike", from: "present", to: "absent" }]);
    expect(cell.outcome).toMatchObject({ kind: "instead", action: "investigate", origin: "counterfactual", introducedIn: 2 });
    // Before the counterfactual the rule simply had nothing to say here.
    expect(cell.before).toEqual({ kind: "silent" });
    expect(cell.runbook).toBe("restart_service");
  });

  it("flipping an untested condition leaves the rule silent: no policy is invented", () => {
    const cell = axis(map, "c-new_version_only").flipped;
    expect(cell.scenario).toBe("every version was failing");
    expect(cell.changes.map((c) => [c.signal, c.to])).toEqual([
      ["new_version_only", "absent"],
      ["all_versions_affected", "present"],
    ]);
    expect(cell.outcome).toEqual({ kind: "silent" });
    expect(cell.before).toBeNull();
    expect(axis(map, "c-deploy_preceded_failure").flipped.outcome).toEqual({ kind: "silent" });
  });

  it("missing evidence on any condition means abstain, never a guess", () => {
    for (const a of map.axes) expect(a.missing.outcome.kind).toBe("abstain");
    expect(axis(map, "c-new_version_only").missing.outcome).toEqual({ kind: "abstain", missing: ["new_version_only"] });
  });

  it("a broadened condition flips only when every alternative is gone", () => {
    const { v2: broad } = learnFromHero({ answer: "Yes, I'd still roll back." });
    const m = deriveBoundaryMap(broad, signals);
    const cell = axis(m, "c-error_spike").flipped;
    expect(cell.changes.map((c) => c.signal)).toEqual(["error_spike", "latency_up"]);
    expect(cell.outcome).toEqual({ kind: "silent" });
  });
});

describe("placing a new incident on the map", () => {
  it("A lands inside the learned region: roll back", () => {
    const p = placeIncident(v2, deriveSignals(traineeCase("A")));
    expect(Object.values(p.positions)).toEqual(["inside", "inside", "inside"]);
    expect(p.outcome).toEqual({ kind: "apply", action: "rollback_deploy" });
    expect(p.runbook).toBe("restart_service");
  });

  it("B leaves the region on version scope: the rule is silent there", () => {
    const p = placeIncident(v2, deriveSignals(traineeCase("B")));
    expect(p.positions["c-new_version_only"]).toBe("flipped");
    expect(p.outcome.kind).toBe("silent");
    expect(p.decisiveAxes).toEqual(["c-new_version_only"]);
  });

  it("C crosses the counterfactual boundary", () => {
    const p = placeIncident(v2, deriveSignals(traineeCase("C")));
    expect(p.outcome).toMatchObject({ kind: "instead", action: "investigate" });
    expect(p.decisiveAxes).toEqual(["c-error_spike"]);
  });

  it("D sits on missing evidence", () => {
    const p = placeIncident(v2, deriveSignals(traineeCase("D")));
    expect(p.positions["c-new_version_only"]).toBe("missing");
    expect(p.outcome.kind).toBe("abstain");
  });
});
