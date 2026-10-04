import { z } from "zod";
import { ACTIONS, ACTION_ORDER } from "./actions";
import { SIGNALS, SIGNAL_ORDER, measurementRule } from "./signals";
import type { ActionId, DecisionRule, IncidentSignal, SignalId, SignalState } from "./types";

// Decision memory: the learned rule compiled into a self-contained,
// versioned JSON artifact. It carries everything a consumer needs to apply
// the judgment (conditions, guardrails, precedence, what to do when evidence
// is missing) and everything a reviewer needs to audit it (the expert's
// words, telemetry, the counterfactual, revision history).
//
// executeDecisionMemory() applies it using only the JSON, never the
// in-memory rule. The benchmark runs on that, which shows the artifact is
// complete: a person, a script or an agent's policy layer can use it as is.

export const MEMORY_SCHEMA = "secondshift.decision-memory/v1";

const SIGNAL = z.enum(SIGNAL_ORDER as [SignalId, ...SignalId[]]);
const ACTION = z.enum(ACTION_ORDER as [ActionId, ...ActionId[]]);
const STATE = z.enum(["present", "absent"]);

export const DecisionMemorySchema = z.object({
  schema: z.literal(MEMORY_SCHEMA),
  ruleId: z.string(),
  version: z.number().int().positive(),
  learnedFrom: z.object({ incidentId: z.string(), decisionsObserved: z.number().int().positive() }),
  decision: z.object({ action: ACTION, insteadOf: ACTION }),
  precedence: z.literal("guardrails_first"),
  conditions: z.array(
    z.object({
      id: z.string(),
      anyOf: z.array(SIGNAL).min(1),
      expected: STATE,
      status: z.enum(["stated", "boundary_tested", "broadened"]),
      introducedIn: z.number().int(),
      testedIn: z.number().int().nullable(),
      expertQuote: z.string().nullable(),
      evidence: z.array(z.string()),
    }),
  ),
  guardrails: z.array(
    z.object({
      id: z.string(),
      when: z.array(z.object({ signal: SIGNAL, state: STATE })).min(1),
      then: z.union([
        z.object({ kind: z.literal("do_instead"), action: ACTION }),
        z.object({ kind: z.literal("stand_down") }),
      ]),
      description: z.string(),
      origin: z.enum(["derived", "counterfactual"]),
      introducedIn: z.number().int(),
      evidence: z.array(z.string()),
    }),
  ),
  /** Signals that must be measurable for the rule to act. */
  evidenceRequirements: z.array(SIGNAL),
  fallback: z.object({
    missingEvidence: z.literal("abstain"),
    noMatch: z.literal("defer_to_runbook"),
    standDown: z.literal("defer_to_runbook"),
  }),
  evidenceStrength: z.object({
    kind: z.literal("heuristic"),
    score: z.number(),
    cap: z.number(),
    factors: z.array(z.object({ label: z.string(), delta: z.number() })),
  }),
  provenance: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["expert_quote", "signal", "counterfactual"]),
      text: z.string(),
      source: z.string(),
      incidentId: z.string(),
    }),
  ),
  revisions: z.array(z.object({ version: z.number().int(), summary: z.string() })),
  signalDefinitions: z.record(z.string(), z.object({ label: z.string(), measuredAs: z.string() })),
});

export type DecisionMemory = z.infer<typeof DecisionMemorySchema>;

const STATUS = { stated: "stated", confirmed: "boundary_tested", broadened: "broadened" } as const;

export function compileDecisionMemory(rule: DecisionRule): DecisionMemory {
  const used = new Set<SignalId>();
  for (const c of rule.conditions) c.anyOf.forEach((id) => used.add(id));
  for (const g of rule.guardrails) g.trigger.forEach((t) => used.add(t.signal));

  return {
    schema: MEMORY_SCHEMA,
    ruleId: rule.id,
    version: rule.version,
    learnedFrom: { incidentId: rule.sourceIncidentId, decisionsObserved: 1 },
    decision: { action: rule.action, insteadOf: rule.overAction },
    precedence: "guardrails_first",
    conditions: rule.conditions.map((c) => ({
      id: c.id,
      anyOf: [...c.anyOf],
      expected: c.expected,
      status: STATUS[c.necessity],
      introducedIn: c.introducedIn,
      testedIn: c.testedIn,
      expertQuote: c.quote,
      evidence: [...c.evidenceIds],
    })),
    guardrails: rule.guardrails.map((g) => ({
      id: g.id,
      when: g.trigger.map((t) => ({ ...t })),
      then: g.insteadAction ? { kind: "do_instead" as const, action: g.insteadAction } : { kind: "stand_down" as const },
      description: g.description,
      origin: g.origin,
      introducedIn: g.introducedIn,
      evidence: [...g.evidenceIds],
    })),
    evidenceRequirements: [...new Set(rule.conditions.flatMap((c) => c.anyOf))],
    fallback: { missingEvidence: "abstain", noMatch: "defer_to_runbook", standDown: "defer_to_runbook" },
    evidenceStrength: {
      kind: "heuristic",
      score: rule.confidence.score,
      cap: rule.confidence.cap,
      factors: rule.confidence.factors.map((f) => ({ ...f })),
    },
    provenance: rule.evidence.map((e) => ({ ...e })),
    revisions: rule.history.map((h) => ({ ...h })),
    signalDefinitions: Object.fromEntries(
      SIGNAL_ORDER.filter((id) => used.has(id)).map((id) => [id, { label: SIGNALS[id].label, measuredAs: measurementRule(id) }]),
    ),
  };
}

export function serializeDecisionMemory(memory: DecisionMemory): string {
  return JSON.stringify(memory, null, 2);
}

export function parseDecisionMemory(json: string): { ok: true; value: DecisionMemory } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: "Not valid JSON" };
  }
  const parsed = DecisionMemorySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }
  return { ok: true, value: parsed.data };
}

export type MemoryDecision =
  | { kind: "act"; action: ActionId; via: string }
  | { kind: "defer_to_runbook"; via: string }
  | { kind: "abstain"; missing: SignalId[] };

/** Apply decision memory to an incident's signal states, using only the artifact. */
export function executeDecisionMemory(memory: DecisionMemory, signals: IncidentSignal[] | Partial<Record<SignalId, SignalState>>): MemoryDecision {
  const state = (id: SignalId): SignalState =>
    Array.isArray(signals) ? (signals.find((s) => s.id === id)?.state ?? "unknown") : (signals[id] ?? "unknown");

  for (const g of memory.guardrails) {
    if (g.when.every((w) => state(w.signal) === w.state)) {
      return g.then.kind === "do_instead" ? { kind: "act", action: g.then.action, via: g.id } : { kind: "defer_to_runbook", via: g.id };
    }
  }
  const results = memory.conditions.map((c) => {
    const states = c.anyOf.map(state);
    return states.some((s) => s === c.expected) ? true : states.some((s) => s === "unknown") ? "unknown" : false;
  });
  if (results.every((r) => r === true)) return { kind: "act", action: memory.decision.action, via: memory.ruleId };
  if (results.some((r) => r === false)) return { kind: "defer_to_runbook", via: "no_match" };
  return {
    kind: "abstain",
    missing: memory.conditions.filter((_, i) => results[i] === "unknown").flatMap((c) => c.anyOf),
  };
}

function when(w: { signal: SignalId; state: "present" | "absent" }[]): string {
  return w.map((x) => (x.state === "present" ? SIGNALS[x.signal].presentPhrase : SIGNALS[x.signal].absentPhrase)).join(" and ");
}

/**
 * The same memory as plain text, for the context window of a language-model
 * agent or a reviewer. Generated from the JSON, so it never says more than
 * the artifact does.
 */
export function renderAgentContext(memory: DecisionMemory): string {
  const lines: string[] = [];
  const a = ACTIONS[memory.decision.action];
  lines.push(
    `Decision memory ${memory.ruleId} v${memory.version}. Learned from an expert on ${memory.learnedFrom.incidentId} (${memory.learnedFrom.decisionsObserved} decision observed). Evidence strength ${memory.evidenceStrength.score.toFixed(2)} (heuristic, capped at ${memory.evidenceStrength.cap}).`,
  );
  lines.push("");
  lines.push("Check these first. If one holds, it decides:");
  for (const g of memory.guardrails) {
    const then = g.then.kind === "do_instead" ? `${ACTIONS[g.then.action].label.toLowerCase()}` : "do not apply this rule; follow the runbook";
    lines.push(`- If ${when(g.when)}: ${then}. (${g.origin === "counterfactual" ? "expert's answer to a counterfactual" : "follows from a stated condition"})`);
  }
  lines.push("");
  lines.push("Otherwise, when ALL of these hold:");
  for (const c of memory.conditions) {
    const what = c.anyOf.map((id) => (c.expected === "present" ? SIGNALS[id].presentPhrase : SIGNALS[id].absentPhrase)).join(" or ");
    const status = c.status === "boundary_tested" ? `boundary tested in v${c.testedIn}` : c.status;
    lines.push(`- ${what} [${status}${c.expertQuote ? `; expert: "${c.expertQuote}"` : ""}]`);
  }
  lines.push(`prefer: ${a.label}, instead of ${ACTIONS[memory.decision.insteadOf].label} (the runbook).`);
  lines.push("");
  lines.push(
    `If any of these cannot be measured (${memory.evidenceRequirements.map((id) => SIGNALS[id].label.toLowerCase()).join("; ")}), do not act on this rule. Get the evidence first.`,
  );
  lines.push("If the conditions do not hold, this memory has no opinion: follow the runbook.");
  return lines.join("\n");
}
