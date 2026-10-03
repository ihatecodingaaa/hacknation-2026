import { ACTIONS, ACTION_ORDER } from "@/domain/actions";
import { expectedAction } from "@/domain/playbook";
import { conditionLabel } from "@/domain/rules";
import type { TraineeCase } from "@/domain/scenarios";
import { SIGNALS, signalById, signalState } from "@/domain/signals";
import type {
  ActionId,
  DecisionRule,
  EvaluationResult,
  IncidentSignal,
  Verdict,
} from "@/domain/types";
import { ConfidenceMeter, EvidenceItem, RuleCard } from "./RulePanel";
import { Label, Section, Tag, cx } from "./ui";

const VERDICT: Record<Verdict, { mark: string; box: string; text: string }> = {
  mismatch: { mark: "✕", box: "border-bad/70 bg-bad/[0.08]", text: "text-bad" },
  aligned: { mark: "✓", box: "border-ok/60 bg-ok/[0.07]", text: "text-ok" },
  uncertain: { mark: "?", box: "border-dashed border-unknown/80 bg-unknown/[0.06]", text: "text-unknown" },
  outside_rule: { mark: "–", box: "border-line-strong bg-raised", text: "text-muted" },
};

function MatchCell({ met }: { met: boolean | "unknown" }) {
  if (met === "unknown") return <Tag tone="unknown" dashed>can&apos;t tell</Tag>;
  return met ? <Tag tone="ok">holds</Tag> : <Tag tone="bad">fails</Tag>;
}

export function CaseTabs({
  cases,
  active,
  onSelect,
}: {
  cases: TraineeCase[];
  active: TraineeCase["key"];
  onSelect: (k: TraineeCase["key"]) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-4">
      {cases.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => onSelect(c.key)}
          className={cx(
            "rounded-[3px] border px-2.5 py-1.5 text-left transition-colors",
            c.key === active ? "border-text/70 bg-raised" : "border-line hover:border-line-strong",
          )}
        >
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[11px] text-muted">{c.key}</span>
            <span className="text-[12.5px] font-medium text-text">{c.name}</span>
          </div>
          <div className="mt-0.5 text-[11px] leading-snug text-faint">{c.tests}</div>
        </button>
      ))}
    </div>
  );
}

export function TraineeFlow({
  rule,
  activeCase,
  cases,
  onSelectCase,
  choice,
  onChoose,
  evaluation,
  signals,
  sourceSignals,
}: {
  rule: DecisionRule;
  activeCase: TraineeCase;
  cases: TraineeCase[];
  onSelectCase: (k: TraineeCase["key"]) => void;
  choice: ActionId | null;
  onChoose: (a: ActionId) => void;
  evaluation: EvaluationResult | null;
  signals: IncidentSignal[];
  sourceSignals: IncidentSignal[];
}) {
  const incident = activeCase.incident;
  const runbook = expectedAction(signals);

  return (
    <div className="space-y-5 px-5 py-4">
      <div>
        <Label className="mb-2">Transfer test · new incidents the expert never saw</Label>
        <CaseTabs cases={cases} active={activeCase.key} onSelect={onSelectCase} />
      </div>

      <section>
        <Label className="mb-2">Trainee on call for {incident.id}: what do you do?</Label>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-5">
          {ACTION_ORDER.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onChoose(id)}
              className={cx(
                "rounded-[3px] border px-2 py-2 text-[12.5px] font-medium transition-colors",
                choice === id
                  ? "border-text bg-text/10 text-text"
                  : "border-line-strong bg-raised text-muted hover:border-muted hover:text-text",
              )}
            >
              {ACTIONS[id].label}
            </button>
          ))}
        </div>
      </section>

      {evaluation && (
        <>
          <section className={cx("rounded-[3px] border px-4 py-3", VERDICT[evaluation.verdict].box)}>
            <div className={cx("flex items-center gap-2 text-[16px] font-semibold", VERDICT[evaluation.verdict].text)}>
              <span className="font-mono">{VERDICT[evaluation.verdict].mark}</span>
              {evaluation.headline}
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-text">{evaluation.explanation}</p>
          </section>

          <section className="grid grid-cols-3 border border-line">
            <div className="border-r border-line px-3 py-2.5">
              <Label>Runbook says</Label>
              <div className="mt-1 text-[14px] font-semibold text-expected">{ACTIONS[runbook.action].label}</div>
              <div className="font-mono text-[10.5px] text-faint">
                {runbook.step.id} · {runbook.step.when}
              </div>
            </div>
            <div className="border-r border-line px-3 py-2.5">
              <Label>Learned expert rule says</Label>
              <div
                className={cx(
                  "mt-1 text-[14px] font-semibold",
                  evaluation.match.recommended ? "text-rule" : "text-muted",
                )}
              >
                {evaluation.match.recommended
                  ? ACTIONS[evaluation.match.recommended].label
                  : evaluation.match.outcome === "uncertain"
                    ? "Verify first"
                    : evaluation.match.outcome === "guardrail"
                      ? `Not ${ACTIONS[rule.action].label.toLowerCase()}`
                      : "No opinion"}
              </div>
              <div className="font-mono text-[10.5px] text-faint">
                {rule.id} v{rule.version} ·{" "}
                {evaluation.match.outcome === "applies"
                  ? "all conditions hold"
                  : evaluation.match.outcome === "guardrail"
                    ? "guardrail fired"
                    : evaluation.match.outcome === "uncertain"
                      ? "evidence missing"
                      : "does not apply"}
              </div>
            </div>
            <div className="px-3 py-2.5">
              <Label>Trainee chose</Label>
              <div className={cx("mt-1 text-[14px] font-semibold", VERDICT[evaluation.verdict].text)}>
                {ACTIONS[evaluation.trainee.action].label}
              </div>
              <div className="font-mono text-[10.5px] text-faint">{incident.id}</div>
            </div>
          </section>

          <section>
            <Label className="mb-1.5">Same judgment, different incident</Label>
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                  <th className="pb-1 font-normal">rule condition</th>
                  <th className="pb-1 font-normal">{rule.sourceIncidentId} (expert)</th>
                  <th className="pb-1 font-normal">{incident.id} (now)</th>
                  <th className="pb-1 text-right font-normal">here</th>
                </tr>
              </thead>
              <tbody>
                {rule.conditions.map((c) => {
                  const m = evaluation.match.conditions.find((x) => x.conditionId === c.id);
                  const id = c.anyOf.find((sid) => signalState(signals, sid) === c.expected) ?? c.anyOf[0];
                  return (
                    <tr key={c.id} className="border-t border-line align-top">
                      <td className="py-1.5 pr-2 text-text">{conditionLabel(c)}</td>
                      <td className="py-1.5 pr-2 font-mono text-[10.5px] text-muted">
                        {signalById(sourceSignals, c.anyOf[0])?.detail}
                      </td>
                      <td className="py-1.5 pr-2 font-mono text-[10.5px] text-muted">{signalById(signals, id)?.detail}</td>
                      <td className="py-1.5 text-right">{m && <MatchCell met={m.met} />}</td>
                    </tr>
                  );
                })}
                {rule.guardrails.map((g) => {
                  const fired = evaluation.match.firedGuardrail?.id === g.id;
                  const unknown = g.trigger.some((t) => signalState(signals, t.signal) === "unknown");
                  return (
                    <tr key={g.id} className="border-t border-line align-top">
                      <td className="py-1.5 pr-2 text-muted" colSpan={3}>
                        <span className="mr-1 font-mono text-bad">✕</span>
                        guardrail: {g.trigger.map((t) => `${SIGNALS[t.signal].label.toLowerCase()} = ${t.state === "present" ? "yes" : "no"}`).join(" and ")}
                      </td>
                      <td className="py-1.5 text-right">
                        {fired ? (
                          <Tag tone="bad">fired</Tag>
                        ) : unknown ? (
                          <Tag tone="unknown" dashed>
                            can&apos;t check
                          </Tag>
                        ) : (
                          <Tag>clear</Tag>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}

export function ProvenancePanel({
  rule,
  evaluation,
}: {
  rule: DecisionRule;
  evaluation: EvaluationResult | null;
}) {
  return (
    <div>
      {evaluation ? (
        <Section title="Why: provenance of this verdict">
          <p className="mb-2.5 text-[12px] leading-snug text-muted">
            Traced back to the expert&apos;s own words and the telemetry they were looking at on {rule.sourceIncidentId}.
          </p>
          {evaluation.match.firedGuardrail && (
            <div className="mb-2.5 rounded-[3px] border border-bad/50 bg-bad/5 px-2.5 py-2 text-[12px] text-text">
              <span className="mr-1 font-mono text-bad">✕</span>
              {evaluation.match.firedGuardrail.description}
            </div>
          )}
          <ul className="space-y-2.5">
            {evaluation.provenance.map((e) => (
              <EvidenceItem key={e.id} e={e} />
            ))}
          </ul>
        </Section>
      ) : (
        <Section title="Why: provenance">
          <p className="text-[12px] leading-snug text-muted">
            Pick the trainee&apos;s action. The verdict will be traced back to the expert&apos;s explanation and the
            incident it came from.
          </p>
        </Section>
      )}
      <Section
        title="Rule being transferred"
        aside={
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[11px] text-muted">{rule.id}</span>
            <Tag tone="rule">v{rule.version}</Tag>
          </div>
        }
      >
        <RuleCard rule={{ ...rule, changedIds: [] }} />
      </Section>
      <Section title="Confidence" className="border-b-0">
        <ConfidenceMeter rule={rule} />
      </Section>
    </div>
  );
}
