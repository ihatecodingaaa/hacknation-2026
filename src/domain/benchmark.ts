import { ACTIONS } from "./actions";
import { executeDecisionMemory, type DecisionMemory } from "./memory";
import { expectedAction } from "./playbook";
import { deriveSignals } from "./signals";
import type { ActionId, IncidentSignal, IncidentState, VersionStats } from "./types";

// Seeded evaluation cases.
//
// Fourteen incidents the expert never saw, each designed to probe one part of
// the learned judgment. The correct response for each is written from the
// fixture's designed root cause, independently of what any policy outputs.
// These are fixtures, not production data, and the UI says so. The numbers
// that come out are computed by running the policies, never typed in.

export interface BenchmarkCase {
  id: string;
  /** What this case probes. */
  probes: string;
  truth: {
    /** The right call, or "abstain" when the deciding evidence is missing. */
    correct: ActionId | "abstain";
    why: string;
  };
  /** Actions that would make this incident worse. */
  harmful: { actions: ActionId[]; why: string } | null;
  incident: IncidentState;
}

interface Spec {
  id: string;
  service: string;
  title: string;
  probes: string;
  truth: BenchmarkCase["truth"];
  harmful?: BenchmarkCase["harmful"];
  deploy?: { version: string; previousVersion: string; completedMinutesAgo: number; rolloutPct: number };
  onset: number | null;
  errors: [number, number];
  latency: [number, number];
  cpu?: number;
  dbHealthy?: boolean;
  /** [new, old] error rates, a single [rate] for one version, or null when missing. */
  versions: [number, number] | [number] | null;
  note: string;
}

/** A 20-minute error series that leaves baseline at the onset. Deterministic. */
function series(baseline: number, current: number, onset: number | null): number[] {
  return Array.from({ length: 20 }, (_, i) => {
    const minutesAgo = 19 - i;
    if (onset === null || minutesAgo > onset) return baseline;
    const t = Math.min(1, (onset - minutesAgo + 1) / Math.max(2, onset));
    return Math.round((baseline + (current - baseline) * t) * 10) / 10;
  });
}

function build(s: Spec): BenchmarkCase {
  const deploy = s.deploy ?? null;
  let versions: VersionStats[] | null = null;
  if (s.versions && s.versions.length === 2) {
    versions = [
      { version: deploy?.version ?? "new", isNew: true, instances: 6, errorRatePct: s.versions[0] },
      { version: deploy?.previousVersion ?? "old", isNew: false, instances: 6, errorRatePct: s.versions[1] },
    ];
  } else if (s.versions && s.versions.length === 1) {
    versions = [{ version: deploy?.version ?? "v1.0.0", isNew: Boolean(deploy), instances: 12, errorRatePct: s.versions[0] }];
  }
  const timeline: IncidentState["timeline"] = [];
  if (deploy) timeline.push({ minutesAgo: deploy.completedMinutesAgo, kind: "deploy", text: `Deploy ${deploy.version} complete, ${deploy.rolloutPct}% rollout` });
  if (s.onset !== null) timeline.push({ minutesAgo: s.onset, kind: "metric", text: "Degradation leaves baseline" });
  timeline.push({ minutesAgo: 1, kind: "note", text: s.note });
  timeline.sort((a, b) => b.minutesAgo - a.minutesAgo);
  return {
    id: s.id,
    probes: s.probes,
    truth: s.truth,
    harmful: s.harmful ?? null,
    incident: {
      id: s.id,
      title: s.title,
      service: s.service,
      severity: "SEV2",
      clock: "seeded",
      deploy,
      degradationOnsetMinutesAgo: s.onset,
      errorRatePct: { baseline: s.errors[0], current: s.errors[1] },
      p99LatencyMs: { baseline: s.latency[0], current: s.latency[1] },
      cpuPct: s.cpu ?? 40,
      dbHealthy: s.dbHealthy ?? true,
      versions,
      errorSeries: series(s.errors[0], s.errors[1], s.onset),
      timeline,
    },
  };
}

const dep = (version: string, previousVersion: string, completedMinutesAgo: number, rolloutPct = 50) => ({
  version,
  previousVersion,
  completedMinutesAgo,
  rolloutPct,
});

export const BENCHMARK_CASES: BenchmarkCase[] = [
  build({
    id: "BM-01", service: "orders-api", title: "orders-api 5xx after a 10% canary",
    probes: "Same pattern, small canary, latency normal",
    truth: { correct: "rollback_deploy", why: "The canary build throws on a new code path; the old version is clean." },
    deploy: dep("v4.3.0", "v4.2.9", 4, 10), onset: 3, errors: [0.2, 4.6], latency: [160, 190], versions: [38.0, 0.2],
    note: "Canary pods failing, stable pods clean",
  }),
  build({
    id: "BM-02", service: "auth-service", title: "auth-service 5xx and latency after deploy",
    probes: "Same pattern with every symptom present",
    truth: { correct: "rollback_deploy", why: "Bad release: token validation regression in the new build." },
    deploy: dep("v8.1.0", "v8.0.7", 11), onset: 9, errors: [0.5, 11.2], latency: [120, 380], versions: [21.7, 0.6],
    note: "Login failures only on v8.1.0 pods",
  }),
  build({
    id: "BM-03", service: "cart-api", title: "cart-api CPU pegged after deploy",
    probes: "Bad deploy that also saturates CPU (runbook says scale out)",
    truth: { correct: "rollback_deploy", why: "The new build spins in a retry loop; more pods would run more of it." },
    deploy: dep("v2.9.0", "v2.8.4", 6), onset: 5, errors: [0.3, 6.4], latency: [200, 520], cpu: 93, versions: [12.5, 0.3],
    note: "CPU 93%, hottest pods are all v2.9.0",
  }),
  build({
    id: "BM-04", service: "search-indexer", title: "search-indexer errors, noisy baseline",
    probes: "Higher baseline and a 12-minute gap: still the same pattern",
    truth: { correct: "rollback_deploy", why: "Schema change in the new release; old pods index fine." },
    deploy: dep("v6.0.2", "v6.0.1", 13), onset: 1, errors: [0.8, 4.1], latency: [400, 460], versions: [5.2, 0.9],
    note: "Baseline error rate is usually ~0.8%",
  }),
  build({
    id: "BM-05", service: "profile-api", title: "profile-api errors that began before the deploy",
    probes: "Timing mismatch: degradation started before the release",
    truth: { correct: "restart_service", why: "Connection pool exhaustion that predates the deploy; a restart clears it." },
    harmful: { actions: ["rollback_deploy"], why: "Rolls back a release that did not cause the problem, adding change mid-incident." },
    deploy: dep("v3.4.1", "v3.4.0", 5), onset: 9, errors: [0.4, 7.9], latency: [220, 260], versions: [8.1, 7.7],
    note: "Pool wait time climbing on every pod",
  }),
  build({
    id: "BM-06", service: "billing-api", title: "billing-api errors 30 minutes after deploy",
    probes: "Bad deploy outside the expert's timing window",
    truth: { correct: "rollback_deploy", why: "A scheduled job in the new release first runs 30 minutes after start." },
    deploy: dep("v12.0.0", "v11.9.3", 34), onset: 4, errors: [0.3, 8.8], latency: [190, 240], versions: [17.4, 0.3],
    note: "Errors only on v12.0.0, starting with the hourly job",
  }),
  build({
    id: "BM-07", service: "recs-api", title: "recs-api failing during an upstream outage",
    probes: "Deploy coincides with an upstream outage: every version fails",
    truth: { correct: "investigate", why: "The feature store upstream is down; neither restart nor rollback helps." },
    harmful: { actions: ["rollback_deploy"], why: "Rolls back a healthy release during an outage it did not cause." },
    deploy: dep("v1.15.0", "v1.14.2", 7), onset: 6, errors: [0.4, 14.2], latency: [250, 1400], versions: [13.9, 14.5],
    note: "feature-store timeouts on all pods",
  }),
  build({
    id: "BM-08", service: "inventory-sync", title: "inventory-sync latency after deploy, errors flat",
    probes: "Latency up, errors normal, right after a deploy (the counterfactual)",
    truth: { correct: "investigate", why: "The expert's stated boundary: latency alone is not enough to blame the deploy." },
    deploy: dep("v0.30.0", "v0.29.5", 5), onset: 4, errors: [0.2, 0.3], latency: [140, 480], versions: [0.3, 0.2],
    note: "5xx flat; p99 up on both versions",
  }),
  build({
    id: "BM-09", service: "media-api", title: "media-api latency, no deploy",
    probes: "Latency up, errors normal, no deploy",
    truth: { correct: "restart_service", why: "GC pressure on long-lived pods; the runbook restart clears it." },
    onset: 12, errors: [0.3, 0.4], latency: [300, 720], cpu: 62, versions: [0.4],
    note: "Pods up for 19 days; old-gen heap near limit",
  }),
  build({
    id: "BM-10", service: "ledger-api", title: "ledger-api failing, database primary degraded",
    probes: "Database incident, no deploy",
    truth: { correct: "failover_db", why: "The primary's disk is failing; failover is the fix." },
    harmful: { actions: ["restart_service"], why: "Restarting every pod during a database brownout adds a reconnect storm." },
    onset: 6, errors: [0.2, 9.5], latency: [180, 900], cpu: 30, dbHealthy: false, versions: [9.5],
    note: "Primary replication lag 40 s, disk latency high",
  }),
  build({
    id: "BM-11", service: "checkout-web", title: "checkout-web saturated by a traffic surge",
    probes: "CPU saturation from load, no deploy",
    truth: { correct: "scale_out", why: "A marketing push tripled traffic; capacity is the problem." },
    onset: 8, errors: [0.3, 3.1], latency: [200, 650], cpu: 96, versions: [3.1],
    note: "Requests per second 3.2x normal",
  }),
  build({
    id: "BM-12", service: "notifications-api", title: "notifications-api errors, version labels missing",
    probes: "Familiar pattern, but per-version metrics are missing",
    truth: { correct: "abstain", why: "The evidence that separates a bad deploy from anything else is missing; get it first." },
    deploy: dep("v0.52.0", "v0.51.1", 6), onset: 5, errors: [0.4, 9.0], latency: [210, 260], versions: null,
    note: "Metrics relabel dropped the version label",
  }),
  build({
    id: "BM-13", service: "pricing-api", title: "pricing-api errors after a 100% rollout",
    probes: "Ambiguous scope: only the new version is running",
    truth: { correct: "rollback_deploy", why: "The new release is bad, but with one version running nothing isolates it." },
    deploy: dep("v7.2.0", "v7.1.9", 7, 100), onset: 6, errors: [0.3, 10.4], latency: [210, 300], versions: [10.4],
    note: "Rollout went straight to 100%",
  }),
  build({
    id: "BM-14", service: "geo-api", title: "geo-api wedged, no deploy",
    probes: "Ordinary runbook case: errors, no deploy, resources normal",
    truth: { correct: "restart_service", why: "A deadlocked worker pool; the runbook restart is right." },
    onset: 5, errors: [0.3, 6.8], latency: [200, 240], cpu: 44, versions: [6.8],
    note: "Thread dump shows workers blocked on one lock",
  }),
];

export type PolicyDecision =
  | { kind: "act"; action: ActionId; note: string }
  | { kind: "abstain"; note: string };

export interface Policy {
  id: string;
  label: string;
  decide(signals: IncidentSignal[]): PolicyDecision;
}

export const RUNBOOK_POLICY: Policy = {
  id: "runbook",
  label: "Runbook only",
  decide(signals) {
    const e = expectedAction(signals);
    return { kind: "act", action: e.action, note: `${e.step.id}: ${e.step.when}` };
  },
};

/** Runbook plus decision memory. Uses only the compiled artifact. */
export function memoryPolicy(memory: DecisionMemory, label: string): Policy {
  return {
    id: `memory-v${memory.version}`,
    label,
    decide(signals) {
      const d = executeDecisionMemory(memory, signals);
      if (d.kind === "act") return { kind: "act", action: d.action, note: d.via === memory.ruleId ? "learned rule applies" : `guardrail ${d.via}` };
      if (d.kind === "abstain") return { kind: "abstain", note: "evidence missing, verify first" };
      const e = expectedAction(signals);
      return {
        kind: "act",
        action: e.action,
        note: d.via === "no_match" ? `rule silent, runbook ${e.step.id}` : `rule stands down (${d.via}), runbook ${e.step.id}`,
      };
    },
  };
}

export type Grade = "correct" | "incorrect" | "abstained";

export function gradeDecision(c: BenchmarkCase, d: PolicyDecision): { grade: Grade; harmful: boolean } {
  if (d.kind === "abstain") return { grade: c.truth.correct === "abstain" ? "correct" : "abstained", harmful: false };
  const harmful = c.harmful?.actions.includes(d.action) ?? false;
  return { grade: d.action === c.truth.correct ? "correct" : "incorrect", harmful };
}

export interface PolicyResult {
  policy: { id: string; label: string };
  totals: { total: number; correct: number; incorrect: number; abstained: number; harmful: number };
  rows: { caseId: string; decision: PolicyDecision; grade: Grade; harmful: boolean }[];
}

export function runBenchmark(cases: BenchmarkCase[], policies: Policy[]): PolicyResult[] {
  const signals = new Map(cases.map((c) => [c.id, deriveSignals(c.incident)]));
  return policies.map((p) => {
    const rows = cases.map((c) => {
      const decision = p.decide(signals.get(c.id)!);
      return { caseId: c.id, decision, ...gradeDecision(c, decision) };
    });
    return {
      policy: { id: p.id, label: p.label },
      totals: {
        total: rows.length,
        correct: rows.filter((r) => r.grade === "correct").length,
        incorrect: rows.filter((r) => r.grade === "incorrect").length,
        abstained: rows.filter((r) => r.grade === "abstained").length,
        harmful: rows.filter((r) => r.harmful).length,
      },
      rows,
    };
  });
}

export function decisionLabel(d: PolicyDecision): string {
  return d.kind === "abstain" ? "Abstain: verify first" : ACTIONS[d.action].label;
}

export function truthLabel(c: BenchmarkCase): string {
  return c.truth.correct === "abstain" ? "Abstain: verify first" : ACTIONS[c.truth.correct].label;
}
