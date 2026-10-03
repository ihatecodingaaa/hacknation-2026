import { describe, expect, it } from "vitest";
import { deriveSignals, signalState } from "@/domain/signals";
import { EXPERT_INCIDENT } from "@/domain/scenarios";
import type { IncidentState, SignalId } from "@/domain/types";
import { traineeCase } from "./helpers";

function states(incident: IncidentState): Record<SignalId, string> {
  return Object.fromEntries(deriveSignals(incident).map((s) => [s.id, s.state])) as Record<SignalId, string>;
}

describe("deriveSignals", () => {
  it("reads the hero incident as a bad deploy isolated to the new version", () => {
    expect(states(EXPERT_INCIDENT)).toEqual({
      deploy_preceded_failure: "present",
      error_spike: "present",
      latency_up: "present",
      new_version_only: "present",
      all_versions_affected: "absent",
      cpu_saturated: "absent",
      db_degraded: "absent",
    });
  });

  it("sees every version failing in the edge case", () => {
    const s = states(traineeCase("B"));
    expect(s.all_versions_affected).toBe("present");
    expect(s.new_version_only).toBe("absent");
    expect(s.deploy_preceded_failure).toBe("present");
  });

  it("sees latency without errors in the boundary case", () => {
    const s = states(traineeCase("C"));
    expect(s.error_spike).toBe("absent");
    expect(s.latency_up).toBe("present");
    expect(s.deploy_preceded_failure).toBe("present");
  });

  it("marks version scope unknown when per-version metrics are missing", () => {
    const s = states(traineeCase("D"));
    expect(s.new_version_only).toBe("unknown");
    expect(s.all_versions_affected).toBe("unknown");
  });

  it("does not blame a deploy that landed after the degradation started", () => {
    const incident = { ...EXPERT_INCIDENT, degradationOnsetMinutesAgo: 20 };
    expect(signalState(deriveSignals(incident), "deploy_preceded_failure")).toBe("absent");
  });

  it("does not blame a deploy outside the timing window", () => {
    const incident = { ...EXPERT_INCIDENT, deploy: { ...EXPERT_INCIDENT.deploy!, completedMinutesAgo: 40 } };
    expect(signalState(deriveSignals(incident), "deploy_preceded_failure")).toBe("absent");
  });

  it("treats no deploy as absent, not unknown", () => {
    const incident = { ...EXPERT_INCIDENT, deploy: null };
    expect(signalState(deriveSignals(incident), "deploy_preceded_failure")).toBe("absent");
  });

  it("cannot isolate a version when only one version is running", () => {
    const incident = {
      ...EXPERT_INCIDENT,
      versions: [{ version: "v2.14.0", isNew: true, instances: 12, errorRatePct: 9.8 }],
    };
    expect(signalState(deriveSignals(incident), "new_version_only")).toBe("unknown");
  });
});
