import { signalState } from "./signals";
import type { ExpectedAction, IncidentSignal, PlaybookStep } from "./types";

/**
 * The "obvious" playbook: what a reasonable on-call runbook says to do.
 * It reacts to symptoms and resources only. It never looks at deploy timing
 * or version scope, which is exactly the judgment SecondShift has to learn.
 */
export const PLAYBOOK: PlaybookStep[] = [
  { id: "RB-1", when: "Database degraded", action: "failover_db", requires: ["db_degraded"] },
  { id: "RB-2", when: "CPU saturated", action: "scale_out", requires: ["cpu_saturated"] },
  { id: "RB-3", when: "5xx error rate elevated", action: "restart_service", requires: ["error_spike"] },
  { id: "RB-4", when: "p99 latency elevated", action: "restart_service", requires: ["latency_up"] },
  { id: "RB-5", when: "No clear symptom", action: "investigate", requires: [] },
];

export function expectedAction(signals: IncidentSignal[]): ExpectedAction {
  const step =
    PLAYBOOK.find((s) =>
      s.requires.every((id) => signalState(signals, id) === "present"),
    ) ?? PLAYBOOK[PLAYBOOK.length - 1];
  return { action: step.action, step, usedSignals: [...step.requires] };
}
