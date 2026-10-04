import type {
  IncidentSignal,
  IncidentState,
  SignalCategory,
  SignalId,
  SignalState,
} from "./types";

export interface SignalMeta {
  id: SignalId;
  label: string;
  category: SignalCategory;
  /** Noun phrase: "if {noun} on its own..." */
  noun: string;
  /** "If {presentPhrase} but {absentPhrase}, ..." */
  presentPhrase: string;
  absentPhrase: string;
  /** "If {missingPhrase}, ..." */
  missingPhrase: string;
}

export const SIGNALS: Record<SignalId, SignalMeta> = {
  deploy_preceded_failure: {
    id: "deploy_preceded_failure",
    label: "Failure began right after a deploy",
    category: "change",
    noun: "a deploy right before the failure",
    presentPhrase: "the failure started right after a deploy",
    absentPhrase: "no deploy lined up with the failure",
    missingPhrase: "deploy timing is unknown",
  },
  error_spike: {
    id: "error_spike",
    label: "Error rate spiked",
    category: "symptom",
    noun: "an error spike",
    presentPhrase: "the error rate spiked",
    absentPhrase: "the error rate stayed normal",
    missingPhrase: "the error rate is not reported",
  },
  latency_up: {
    id: "latency_up",
    label: "Latency elevated",
    category: "symptom",
    noun: "rising latency",
    presentPhrase: "latency increased",
    absentPhrase: "latency stayed normal",
    missingPhrase: "latency is not reported",
  },
  new_version_only: {
    id: "new_version_only",
    label: "Only the new version is failing",
    category: "scope",
    noun: "failures isolated to the new version",
    presentPhrase: "only the new version was failing",
    absentPhrase: "the failures weren't isolated to the new version",
    missingPhrase: "per-version metrics are missing",
  },
  all_versions_affected: {
    id: "all_versions_affected",
    label: "All versions failing",
    category: "scope",
    noun: "failures on every version",
    presentPhrase: "every version was failing",
    absentPhrase: "the old version was healthy",
    missingPhrase: "per-version metrics are missing",
  },
  cpu_saturated: {
    id: "cpu_saturated",
    label: "CPU saturated",
    category: "resource",
    noun: "CPU saturation",
    presentPhrase: "CPU was saturated",
    absentPhrase: "CPU was normal",
    missingPhrase: "CPU is not reported",
  },
  db_degraded: {
    id: "db_degraded",
    label: "Database degraded",
    category: "resource",
    noun: "a degraded database",
    presentPhrase: "the database was degraded",
    absentPhrase: "the database was healthy",
    missingPhrase: "database health is unknown",
  },
};

/**
 * Signals measured from the same data move together: per-version error rates
 * decide both scope signals. Used when building coherent hypotheticals.
 */
export const COUPLED: Partial<Record<SignalId, SignalId>> = {
  new_version_only: "all_versions_affected",
  all_versions_affected: "new_version_only",
};

export const SIGNAL_ORDER: SignalId[] = [
  "deploy_preceded_failure",
  "error_spike",
  "latency_up",
  "new_version_only",
  "all_versions_affected",
  "cpu_saturated",
  "db_degraded",
];

// Thresholds. Kept explicit so the UI can say exactly why a signal fired.
export const THRESHOLDS = {
  /** Error rate counts as a spike above max(floor, baseline x factor). */
  errorSpikeFactor: 3,
  errorSpikeFloorPct: 2,
  latencyFactor: 1.5,
  cpuSaturatedPct: 85,
  /** Degradation must start within this many minutes after a deploy. */
  deployWindowMin: 15,
  /** An old version is "healthy" at or below max(floor, baseline x factor). */
  healthyFactor: 2,
  healthyFloorPct: 1,
};

function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function spikeThreshold(baseline: number): number {
  return Math.max(
    THRESHOLDS.errorSpikeFloorPct,
    baseline * THRESHOLDS.errorSpikeFactor,
  );
}

function healthyCeiling(baseline: number): number {
  return Math.max(THRESHOLDS.healthyFloorPct, baseline * THRESHOLDS.healthyFactor);
}

function deployPrecededFailure(incident: IncidentState): IncidentSignal {
  const id = "deploy_preceded_failure";
  const { deploy, degradationOnsetMinutesAgo: onset } = incident;
  if (!deploy) {
    return { id, state: "absent", detail: "No deploy in the last hour" };
  }
  if (onset === null) {
    return {
      id,
      state: "absent",
      detail: `Deploy ${deploy.version} ${deploy.completedMinutesAgo}m ago, no degradation`,
    };
  }
  const gap = deploy.completedMinutesAgo - onset;
  if (gap >= 0 && gap <= THRESHOLDS.deployWindowMin) {
    return {
      id,
      state: "present",
      detail: `Deploy ${deploy.version} done ${deploy.completedMinutesAgo}m ago, degradation ${gap === 0 ? "same minute" : `${gap}m later`}`,
    };
  }
  return {
    id,
    state: "absent",
    detail:
      gap < 0
        ? `Degradation started ${-gap}m before deploy ${deploy.version}`
        : `Degradation started ${gap}m after deploy ${deploy.version}, outside ${THRESHOLDS.deployWindowMin}m window`,
  };
}

function errorSpike(incident: IncidentState): IncidentSignal {
  const { baseline, current } = incident.errorRatePct;
  const present = current >= spikeThreshold(baseline);
  return {
    id: "error_spike",
    state: present ? "present" : "absent",
    detail: `5xx ${pct(baseline)} → ${pct(current)}`,
  };
}

function latencyUp(incident: IncidentState): IncidentSignal {
  const { baseline, current } = incident.p99LatencyMs;
  return {
    id: "latency_up",
    state: current >= baseline * THRESHOLDS.latencyFactor ? "present" : "absent",
    detail: `p99 ${baseline}ms → ${current}ms`,
  };
}

function versionScope(incident: IncidentState): {
  newOnly: IncidentSignal;
  all: IncidentSignal;
} {
  const versions = incident.versions;
  if (!versions) {
    const detail = "Per-version metrics unavailable";
    return {
      newOnly: { id: "new_version_only", state: "unknown", detail },
      all: { id: "all_versions_affected", state: "unknown", detail },
    };
  }
  const fresh = versions.filter((v) => v.isNew);
  const old = versions.filter((v) => !v.isNew);
  const breakdown = versions
    .map((v) => `${v.version}: ${pct(v.errorRatePct)}`)
    .join(" · ");
  const baseline = incident.errorRatePct.baseline;
  const failing = (v: { errorRatePct: number }) =>
    v.errorRatePct >= spikeThreshold(baseline);
  const healthy = (v: { errorRatePct: number }) =>
    v.errorRatePct <= healthyCeiling(baseline);

  const allFailing = versions.length > 0 && versions.every(failing);
  const all: IncidentSignal = {
    id: "all_versions_affected",
    state: allFailing ? "present" : "absent",
    detail: breakdown,
  };

  if (fresh.length === 0 || old.length === 0) {
    // With a single version there is nothing to compare: "only the new one"
    // and "every one" are both unanswerable, not true.
    const detail = `Only one version running (${breakdown}), nothing to compare against`;
    return {
      newOnly: { id: "new_version_only", state: "unknown", detail },
      all: { id: "all_versions_affected", state: "unknown", detail },
    };
  }
  const newOnly = fresh.every(failing) && old.every(healthy);
  return {
    newOnly: {
      id: "new_version_only",
      state: newOnly ? "present" : "absent",
      detail: breakdown,
    },
    all,
  };
}

function cpuSaturated(incident: IncidentState): IncidentSignal {
  return {
    id: "cpu_saturated",
    state: incident.cpuPct >= THRESHOLDS.cpuSaturatedPct ? "present" : "absent",
    detail: `CPU ${incident.cpuPct}%`,
  };
}

function dbDegraded(incident: IncidentState): IncidentSignal {
  return {
    id: "db_degraded",
    state: incident.dbHealthy ? "absent" : "present",
    detail: incident.dbHealthy ? "Primary healthy" : "Primary degraded",
  };
}

/** Turn raw telemetry into signal states. Same code for every incident. */
export function deriveSignals(incident: IncidentState): IncidentSignal[] {
  const scope = versionScope(incident);
  const byId: Record<SignalId, IncidentSignal> = {
    deploy_preceded_failure: deployPrecededFailure(incident),
    error_spike: errorSpike(incident),
    latency_up: latencyUp(incident),
    new_version_only: scope.newOnly,
    all_versions_affected: scope.all,
    cpu_saturated: cpuSaturated(incident),
    db_degraded: dbDegraded(incident),
  };
  return SIGNAL_ORDER.map((id) => byId[id]);
}

export function signalState(
  signals: IncidentSignal[],
  id: SignalId,
): SignalState {
  return signals.find((s) => s.id === id)?.state ?? "unknown";
}

export function signalById(
  signals: IncidentSignal[],
  id: SignalId,
): IncidentSignal | undefined {
  return signals.find((s) => s.id === id);
}

/** How each signal is measured, in words. Exported with decision memory so a consumer can reproduce it. */
export function measurementRule(id: SignalId): string {
  const t = THRESHOLDS;
  switch (id) {
    case "deploy_preceded_failure":
      return `Degradation began 0-${t.deployWindowMin} min after a deploy completed`;
    case "error_spike":
      return `5xx rate >= max(${t.errorSpikeFloorPct}%, ${t.errorSpikeFactor}x baseline)`;
    case "latency_up":
      return `p99 latency >= ${t.latencyFactor}x baseline`;
    case "new_version_only":
      return `Every new version failing (>= spike threshold) and every old version healthy (<= max(${t.healthyFloorPct}%, ${t.healthyFactor}x baseline)); unknown without per-version data or with one version`;
    case "all_versions_affected":
      return "Every running version at or above the spike threshold; unknown without per-version data or with one version";
    case "cpu_saturated":
      return `CPU >= ${t.cpuSaturatedPct}%`;
    case "db_degraded":
      return "Database primary reported unhealthy";
  }
}
