"use client";

import { useMemo, useState } from "react";
import { ACTIONS } from "@/domain/actions";
import {
  BENCHMARK_CASES,
  RUNBOOK_POLICY,
  decisionLabel,
  memoryPolicy,
  runBenchmark,
  truthLabel,
  type Grade,
  type PolicyResult,
} from "@/domain/benchmark";
import {
  compileDecisionMemory,
  parseDecisionMemory,
  renderAgentContext,
  serializeDecisionMemory,
  type DecisionMemory,
} from "@/domain/memory";
import { SIGNALS, deriveSignals } from "@/domain/signals";
import type { DecisionRule } from "@/domain/types";
import { Button, Tag, cx } from "./ui";

/** Compile, serialize and re-parse: everything downstream uses the artifact, not the in-memory rule. */
export function useDecisionMemory(rule: DecisionRule | null) {
  return useMemo(() => {
    if (!rule) return null;
    const json = serializeDecisionMemory(compileDecisionMemory(rule));
    const parsed = parseDecisionMemory(json);
    return parsed.ok ? { json, memory: parsed.value } : null;
  }, [rule]);
}

export function useBenchmark(ruleV1: DecisionRule | null, rule: DecisionRule | null): PolicyResult[] | null {
  return useMemo(() => {
    if (!rule) return null;
    const memo = (r: DecisionRule) => {
      const parsed = parseDecisionMemory(serializeDecisionMemory(compileDecisionMemory(r)));
      if (!parsed.ok) throw new Error(parsed.error);
      return parsed.value;
    };
    const policies = [RUNBOOK_POLICY];
    if (ruleV1 && ruleV1.version !== rule.version) {
      policies.push(memoryPolicy(memo(ruleV1), `+ memory v${ruleV1.version} (before counterfactual)`));
    }
    policies.push(memoryPolicy(memo(rule), `+ memory v${rule.version}${rule.version > 1 ? " (after counterfactual)" : ""}`));
    return runBenchmark(BENCHMARK_CASES, policies);
  }, [ruleV1, rule]);
}

const GRADE_BOX: Record<Grade, string> = {
  correct: "bg-rule border-rule",
  abstained: "bg-unknown/25 border-unknown border-dashed",
  incorrect: "bg-bad/70 border-bad",
};

function Totals({ r, large }: { r: PolicyResult; large?: boolean }) {
  const t = r.totals;
  return (
    <div className={cx("font-mono text-muted", large ? "text-[13px]" : "text-[11.5px]")}>
      <span className={cx("font-semibold text-text", large ? "text-[22px]" : "text-[15px]")}>{t.correct}</span>
      <span className="text-faint"> / {t.total} correct</span>
      <span> · {t.abstained} abstained · {t.incorrect} incorrect · {t.harmful} harmful</span>
    </div>
  );
}

export function BenchmarkPanel({
  results,
  large = false,
  showTable = false,
}: {
  results: PolicyResult[];
  large?: boolean;
  showTable?: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const c = BENCHMARK_CASES.find((x) => x.id === selected) ?? null;

  return (
    <div>
      <div className="space-y-3">
        {results.map((r) => (
          <div key={r.policy.id}>
            <div className={cx("font-medium", r.policy.id === "runbook" ? "text-expected" : "text-rule", large ? "text-[15px]" : "text-[13px]")}>
              {r.policy.id === "runbook" ? r.policy.label : `Runbook ${r.policy.label}`}
            </div>
            <Totals r={r} large={large} />
            <div className="mt-1.5 grid grid-cols-[repeat(14,minmax(0,1fr))] gap-1" role="group" aria-label={`${r.policy.label}: one square per case`}>
              {r.rows.map((row) => (
                <button
                  key={row.caseId}
                  type="button"
                  onClick={() => setSelected(selected === row.caseId ? null : row.caseId)}
                  title={`${row.caseId}: ${decisionLabel(row.decision)} (${row.grade})`}
                  aria-label={`${row.caseId}: ${decisionLabel(row.decision)}, ${row.grade}`}
                  className={cx(
                    "rounded-[2px] border transition-opacity hover:opacity-80",
                    large ? "h-7" : "h-5",
                    GRADE_BOX[row.grade],
                    selected === row.caseId && "outline outline-2 outline-offset-1 outline-text",
                  )}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-muted">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[2px] bg-rule" />correct</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[2px] border border-dashed border-unknown bg-unknown/25" />abstained (verify first)</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[2px] bg-bad/70" />incorrect</span>
        <span className="text-faint">Select a square to inspect the case.</span>
      </div>

      {c && (
        <div className="mt-3 border border-line bg-panel px-3 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-[14px] font-semibold text-text">
              <span className="mr-2 font-mono text-muted">{c.id}</span>
              {c.incident.title}
            </div>
            <button type="button" onClick={() => setSelected(null)} className="font-mono text-[11px] text-muted hover:text-text">
              close
            </button>
          </div>
          <div className="mt-0.5 text-[12.5px] text-muted">Probes: {c.probes}</div>
          <div className="mt-2 flex flex-wrap gap-1">
            {deriveSignals(c.incident).map((s) => (
              <Tag key={s.id} tone={s.state === "present" ? "bad" : s.state === "unknown" ? "unknown" : "muted"} dashed={s.state === "unknown"}>
                {SIGNALS[s.id].label}: {s.state === "present" ? "yes" : s.state === "absent" ? "no" : "?"}
              </Tag>
            ))}
          </div>
          <div className="mt-2.5 text-[12.5px]">
            <span className="text-faint">Ground truth (from the fixture&apos;s designed cause): </span>
            <span className="font-medium text-text">{truthLabel(c)}</span>
            <span className="text-muted">. {c.truth.why}</span>
          </div>
          {c.harmful && (
            <div className="mt-1 text-[12px] text-muted">
              Harmful here: {c.harmful.actions.map((a) => ACTIONS[a].label).join(", ")}. {c.harmful.why}
            </div>
          )}
          <table className="mt-2 w-full text-[12.5px]">
            <tbody>
              {results.map((r) => {
                const row = r.rows.find((x) => x.caseId === c.id)!;
                return (
                  <tr key={r.policy.id} className="border-t border-line">
                    <td className="py-1.5 pr-2 text-muted">{r.policy.label}</td>
                    <td className="py-1.5 pr-2 text-text">{decisionLabel(row.decision)}</td>
                    <td className="py-1.5 pr-2 font-mono text-[11px] text-faint">{row.decision.note}</td>
                    <td className="py-1.5 text-right">
                      <Tag tone={row.grade === "correct" ? "rule" : row.grade === "abstained" ? "unknown" : "bad"}>{row.grade}</Tag>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showTable && (
        <table className="mt-4 w-full text-[12px]">
          <thead>
            <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
              <th className="pb-1 pr-2 font-normal">case</th>
              <th className="pb-1 pr-2 font-normal">probes</th>
              <th className="pb-1 pr-2 font-normal">truth</th>
              {results.map((r) => (
                <th key={r.policy.id} className="pb-1 pr-2 font-normal">
                  {r.policy.id === "runbook" ? "runbook" : r.policy.id.replace("memory-", "memory ")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {BENCHMARK_CASES.map((bc) => (
              <tr key={bc.id} className="border-t border-line align-top">
                <td className="py-1.5 pr-2 font-mono text-muted">{bc.id}</td>
                <td className="py-1.5 pr-2 text-muted">{bc.probes}</td>
                <td className="py-1.5 pr-2 text-text">{truthLabel(bc)}</td>
                {results.map((r) => {
                  const row = r.rows.find((x) => x.caseId === bc.id)!;
                  return (
                    <td
                      key={r.policy.id}
                      className={cx("py-1.5 pr-2", row.grade === "correct" ? "text-rule" : row.grade === "abstained" ? "text-unknown" : "text-bad")}
                    >
                      {decisionLabel(row.decision)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
        Seeded evaluation cases: 14 fixtures the expert never saw, each built to probe one boundary. Ground truth is written from
        each case&apos;s designed root cause, independently of any policy. Scores are computed live from the decision memory
        artifact. This is not production performance.
      </p>
    </div>
  );
}

export function MemoryPanel({ json, memory, large = false }: { json: string; memory: DecisionMemory; large?: boolean }) {
  const [tab, setTab] = useState<"json" | "context">("json");
  const context = useMemo(() => renderAgentContext(memory), [memory]);

  function download() {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${memory.ruleId.toLowerCase()}-v${memory.version}.decision-memory.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-[3px] border border-line-strong p-0.5" role="tablist" aria-label="Decision memory format">
          {(
            [
              ["json", "JSON artifact"],
              ["context", "As agent context"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cx("rounded-[2px] px-2.5 py-1 text-[12px]", tab === k ? "bg-raised text-text" : "text-muted hover:text-text")}
            >
              {label}
            </button>
          ))}
        </div>
        <Button onClick={download}>Download .json</Button>
      </div>
      <div className="mt-2 font-mono text-[11px] text-muted">
        {memory.schema} · {memory.ruleId} v{memory.version} · {memory.conditions.length} conditions · {memory.guardrails.length} guardrails ·
        schema-validated
      </div>
      <pre
        className={cx(
          "mt-2 overflow-auto rounded-[3px] border border-line bg-bg p-3 font-mono leading-relaxed text-muted",
          large ? "max-h-[420px] text-[12px]" : "max-h-[520px] text-[11px]",
          tab === "context" && "whitespace-pre-wrap",
        )}
        tabIndex={0}
      >
        {tab === "json" ? json : context}
      </pre>
      <p className="mt-2 text-[11.5px] leading-relaxed text-faint">
        The scores above come from an evaluator that reads only this file. The text view is generated from the same file and can
        be given to an agent as context or used as a policy check. No autonomous agent is running here.
      </p>
    </div>
  );
}


