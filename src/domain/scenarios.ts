import type { IncidentState } from "./types";

// Seeded demo incidents. These are fixtures, not live telemetry, and the UI
// labels them as such. Each one is shaped to exercise a specific path through
// the rule evaluator.

/** Expert shift: bad deploy on a 50% progressive rollout. */
export const EXPERT_INCIDENT: IncidentState = {
  id: "INC-2041",
  title: "checkout-api 5xx errors elevated",
  service: "checkout-api",
  severity: "SEV2",
  clock: "03:14 UTC",
  deploy: {
    version: "v2.14.0",
    previousVersion: "v2.13.2",
    completedMinutesAgo: 8,
    rolloutPct: 50,
  },
  degradationOnsetMinutesAgo: 7,
  errorRatePct: { baseline: 0.3, current: 9.8 },
  p99LatencyMs: { baseline: 210, current: 640 },
  cpuPct: 41,
  dbHealthy: true,
  versions: [
    { version: "v2.14.0", isNew: true, instances: 6, errorRatePct: 19.3 },
    { version: "v2.13.2", isNew: false, instances: 6, errorRatePct: 0.3 },
  ],
  errorSeries: [
    0.3, 0.2, 0.3, 0.3, 0.4, 0.3, 0.2, 0.3, 0.3, 0.3, 0.3, 0.3, 1.2, 3.4, 5.9,
    7.6, 8.8, 9.4, 9.9, 9.8,
  ],
  timeline: [
    { minutesAgo: 11, kind: "deploy", text: "Deploy v2.14.0 started, progressive rollout to 50%" },
    { minutesAgo: 8, kind: "deploy", text: "Rollout complete: 6 of 12 pods on v2.14.0" },
    { minutesAgo: 7, kind: "metric", text: "5xx leaves baseline (0.3% → 1.2%)" },
    { minutesAgo: 5, kind: "alert", text: "PagerDuty: checkout-api 5xx > 5%" },
    { minutesAgo: 3, kind: "metric", text: "p99 latency 640 ms (baseline 210 ms)" },
    { minutesAgo: 1, kind: "note", text: "CPU 41% · DB primary healthy" },
  ],
};

export interface TraineeCase {
  key: "A" | "B" | "C" | "D";
  name: string;
  /** What this case proves about the learned rule. */
  tests: string;
  incident: IncidentState;
}

export const TRAINEE_CASES: TraineeCase[] = [
  {
    key: "A",
    name: "New incident",
    tests: "Different service and numbers, same hidden pattern",
    incident: {
      id: "INC-2057",
      title: "payments-gateway 5xx errors elevated",
      service: "payments-gateway",
      severity: "SEV2",
      clock: "14:32 UTC",
      deploy: {
        version: "v5.2.0",
        previousVersion: "v5.1.4",
        completedMinutesAgo: 6,
        rolloutPct: 25,
      },
      degradationOnsetMinutesAgo: 5,
      errorRatePct: { baseline: 0.2, current: 7.4 },
      p99LatencyMs: { baseline: 180, current: 450 },
      cpuPct: 38,
      dbHealthy: true,
      versions: [
        { version: "v5.2.0", isNew: true, instances: 4, errorRatePct: 29.0 },
        { version: "v5.1.4", isNew: false, instances: 12, errorRatePct: 0.2 },
      ],
      errorSeries: [
        0.2, 0.2, 0.1, 0.2, 0.2, 0.3, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2,
        1.8, 4.1, 6.0, 6.9, 7.3, 7.4,
      ],
      timeline: [
        { minutesAgo: 9, kind: "deploy", text: "Deploy v5.2.0 started, canary 25%" },
        { minutesAgo: 6, kind: "deploy", text: "Canary complete: 4 of 16 pods on v5.2.0" },
        { minutesAgo: 5, kind: "metric", text: "5xx leaves baseline (0.2% → 1.8%)" },
        { minutesAgo: 3, kind: "alert", text: "PagerDuty: payments-gateway 5xx > 5%" },
        { minutesAgo: 1, kind: "note", text: "CPU 38% · DB primary healthy" },
      ],
    },
  },
  {
    key: "B",
    name: "Edge case",
    tests: "Deploy just happened, but every version is failing",
    incident: {
      id: "INC-2063",
      title: "search-api 5xx errors elevated",
      service: "search-api",
      severity: "SEV2",
      clock: "09:47 UTC",
      deploy: {
        version: "v3.8.1",
        previousVersion: "v3.8.0",
        completedMinutesAgo: 9,
        rolloutPct: 50,
      },
      degradationOnsetMinutesAgo: 7,
      errorRatePct: { baseline: 0.4, current: 12.6 },
      p99LatencyMs: { baseline: 240, current: 910 },
      cpuPct: 52,
      dbHealthy: true,
      versions: [
        { version: "v3.8.1", isNew: true, instances: 8, errorRatePct: 12.9 },
        { version: "v3.8.0", isNew: false, instances: 8, errorRatePct: 12.3 },
      ],
      errorSeries: [
        0.4, 0.3, 0.4, 0.4, 0.5, 0.4, 0.4, 0.3, 0.4, 0.4, 0.4, 0.4, 3.1, 7.8,
        10.2, 11.9, 12.4, 12.8, 12.5, 12.6,
      ],
      timeline: [
        { minutesAgo: 12, kind: "deploy", text: "Deploy v3.8.1 started, 50% rollout" },
        { minutesAgo: 9, kind: "deploy", text: "Rollout complete: 8 of 16 pods on v3.8.1" },
        { minutesAgo: 7, kind: "metric", text: "5xx leaves baseline (0.4% → 3.1%)" },
        { minutesAgo: 7, kind: "note", text: "Upstream catalog-service p99 4.2 s, timeouts rising" },
        { minutesAgo: 5, kind: "alert", text: "PagerDuty: search-api 5xx > 5%" },
        { minutesAgo: 2, kind: "metric", text: "v3.8.0 and v3.8.1 failing at the same rate" },
      ],
    },
  },
  {
    key: "C",
    name: "Boundary case",
    tests: "Deploy just happened, latency is up, errors are normal",
    incident: {
      id: "INC-2071",
      title: "inventory-api p99 latency elevated",
      service: "inventory-api",
      severity: "SEV3",
      clock: "11:05 UTC",
      deploy: {
        version: "v1.22.0",
        previousVersion: "v1.21.3",
        completedMinutesAgo: 5,
        rolloutPct: 50,
      },
      degradationOnsetMinutesAgo: 4,
      errorRatePct: { baseline: 0.2, current: 0.3 },
      p99LatencyMs: { baseline: 150, current: 520 },
      cpuPct: 47,
      dbHealthy: true,
      versions: [
        { version: "v1.22.0", isNew: true, instances: 6, errorRatePct: 0.3 },
        { version: "v1.21.3", isNew: false, instances: 6, errorRatePct: 0.3 },
      ],
      errorSeries: [
        0.2, 0.2, 0.3, 0.2, 0.2, 0.2, 0.3, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2,
        0.3, 0.3, 0.2, 0.3, 0.3, 0.3,
      ],
      timeline: [
        { minutesAgo: 8, kind: "deploy", text: "Deploy v1.22.0 started, 50% rollout" },
        { minutesAgo: 5, kind: "deploy", text: "Rollout complete: 6 of 12 pods on v1.22.0" },
        { minutesAgo: 4, kind: "metric", text: "p99 latency leaves baseline (150 ms → 290 ms)" },
        { minutesAgo: 2, kind: "alert", text: "PagerDuty: inventory-api p99 > 400 ms" },
        { minutesAgo: 1, kind: "note", text: "5xx flat at 0.3% · DB primary healthy" },
      ],
    },
  },
  {
    key: "D",
    name: "Missing data",
    tests: "Pattern looks familiar, but per-version metrics are missing",
    incident: {
      id: "INC-2078",
      title: "notifications-worker error rate elevated",
      service: "notifications-worker",
      severity: "SEV2",
      clock: "22:18 UTC",
      deploy: {
        version: "v0.41.0",
        previousVersion: "v0.40.2",
        completedMinutesAgo: 7,
        rolloutPct: 50,
      },
      degradationOnsetMinutesAgo: 6,
      errorRatePct: { baseline: 0.5, current: 8.1 },
      p99LatencyMs: { baseline: 300, current: 330 },
      cpuPct: 44,
      dbHealthy: true,
      versions: null,
      errorSeries: [
        0.5, 0.4, 0.5, 0.6, 0.5, 0.5, 0.4, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 2.2,
        4.9, 6.8, 7.5, 8.0, 8.2, 8.1,
      ],
      timeline: [
        { minutesAgo: 10, kind: "deploy", text: "Deploy v0.41.0 started, 50% rollout" },
        { minutesAgo: 7, kind: "deploy", text: "Rollout complete: 5 of 10 workers on v0.41.0" },
        { minutesAgo: 6, kind: "metric", text: "5xx leaves baseline (0.5% → 2.2%)" },
        { minutesAgo: 4, kind: "alert", text: "PagerDuty: notifications-worker errors > 5%" },
        { minutesAgo: 3, kind: "note", text: "Metrics relabel dropped the version label: no per-version breakdown" },
      ],
    },
  },
];

/**
 * Scripted fallback answers, used when live voice is unavailable or the
 * presenter wants a deterministic run. Always shown with a "scripted" tag.
 */
export const SCRIPTED = {
  explanation:
    "The failures started right after the deployment and only the new version is affected. Restarting would just restart the bad version.",
  counterfactualAnswer:
    "No. I would investigate first because latency alone is not enough evidence that the deployment caused the incident.",
  vagueExplanation: "Honestly it just felt off. I've seen this kind of thing before.",
};
