import { ACTIONS } from "@/domain/actions";
import { conditionLabel } from "@/domain/rules";
import { SIGNALS } from "@/domain/signals";
import type { DecisionRule, Evidence, Guardrail, RuleCondition } from "@/domain/types";
import { Label, Section, SourceTag, Tag, cx } from "./ui";

const NECESSITY: Record<RuleCondition["necessity"], { text: string; tone: "muted" | "rule" | "diverge" }> = {
  stated: { text: "stated", tone: "muted" },
  confirmed: { text: "boundary tested", tone: "rule" },
  broadened: { text: "broadened", tone: "diverge" },
};

function ChangeBar({ changed }: { changed: boolean }) {
  return <span className={cx("w-[3px] shrink-0 self-stretch rounded-full", changed ? "bg-rule" : "bg-transparent")} />;
}

function GuardrailRow({ g, changed, version }: { g: Guardrail; changed: boolean; version: number }) {
  return (
    <li className="flex gap-2">
      <ChangeBar changed={changed} />
      <div className="flex-1 py-0.5">
        <div className="text-[12.5px] leading-snug text-text">
          <span className="mr-1 font-mono text-bad">✕</span>
          {g.description}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Tag tone={g.origin === "counterfactual" ? "rule" : "muted"}>
            {g.origin === "counterfactual" ? "from counterfactual" : "derived from condition"}
          </Tag>
          {g.insteadAction && <Tag tone="expert">instead: {ACTIONS[g.insteadAction].label}</Tag>}
          {changed && version > 1 && <Tag tone="rule">new in v{version}</Tag>}
        </div>
        <div className="mt-1 font-mono text-[10.5px] text-faint">
          fires when{" "}
          {g.trigger
            .map((t) => `${SIGNALS[t.signal].label.toLowerCase()} = ${t.state === "present" ? "yes" : "no"}`)
            .join(" and ")}
        </div>
      </div>
    </li>
  );
}

export function EvidenceItem({ e }: { e: Evidence }) {
  return (
    <li className="border-l-2 border-line-strong pl-2.5">
      {e.kind === "counterfactual" ? (
        <div className="whitespace-pre-line text-[12px] leading-snug text-text">{e.text}</div>
      ) : e.kind === "expert_quote" ? (
        <div className="text-[12.5px] italic leading-snug text-text">&ldquo;{e.text}&rdquo;</div>
      ) : (
        <div className="font-mono text-[11px] leading-snug text-muted">{e.text}</div>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <SourceTag source={e.source} />
        <span className="font-mono text-[10px] text-faint">{e.incidentId}</span>
      </div>
    </li>
  );
}

export function ConfidenceMeter({ rule }: { rule: DecisionRule }) {
  const c = rule.confidence;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[20px] font-semibold text-text">{c.score.toFixed(2)}</span>
        <Tag tone={c.level === "high" ? "rule" : c.level === "medium" ? "diverge" : "bad"}>{c.level}</Tag>
      </div>
      <div className="relative mt-1.5 h-1.5 w-full rounded-full bg-line">
        <div className="h-full rounded-full bg-rule transition-[width] duration-500" style={{ width: `${c.score * 100}%` }} />
        <div className="absolute top-[-3px] h-3 w-px bg-muted" style={{ left: `${c.cap * 100}%` }} title={`cap ${c.cap}`} />
      </div>
      <ul className="mt-2 space-y-0.5 font-mono text-[11px]">
        {c.factors.map((f) => (
          <li key={f.label} className="flex gap-2">
            <span className={cx("w-10 shrink-0 text-right", f.delta >= 0 ? "text-rule" : "text-bad")}>
              {f.delta >= 0 ? "+" : ""}
              {f.delta.toFixed(2)}
            </span>
            <span className="text-muted">{f.label}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[11px] leading-snug text-faint">
        A transparent heuristic, not a probability: the sum of the factors above, capped at {c.cap}. {c.capReason}
      </p>
    </div>
  );
}

export function RuleCard({ rule }: { rule: DecisionRule }) {
  const changed = new Set(rule.changedIds);
  return (
    <div className="font-mono text-[12.5px]">
      {rule.conditions.map((c, i) => (
        <div key={c.id} className="flex gap-2">
          <ChangeBar changed={changed.has(c.id)} />
          <span className="w-10 shrink-0 pt-1 text-[11px] font-semibold text-rule">{i === 0 ? "IF" : "AND"}</span>
          <div className="flex-1 py-1">
            <div className="font-sans text-[13px] leading-snug text-text">{conditionLabel(c)}</div>
            <div className="mt-0.5 flex gap-1.5">
              <Tag tone={NECESSITY[c.necessity].tone}>{NECESSITY[c.necessity].text}</Tag>
              {changed.has(c.id) && rule.version > 1 && <Tag tone="rule">updated in v{rule.version}</Tag>}
            </div>
          </div>
        </div>
      ))}
      <div className="mt-1 flex gap-2 border-t border-line pt-2">
        <span className="w-[3px] shrink-0" />
        <span className="w-10 shrink-0 pt-0.5 text-[11px] font-semibold text-rule">THEN</span>
        <div className="flex-1">
          <div className="font-sans text-[15px] font-semibold text-expert">{ACTIONS[rule.action].label}</div>
          <div className="font-sans text-[12px] text-muted">
            instead of <span className="text-expected">{ACTIONS[rule.overAction].label}</span> (runbook)
          </div>
        </div>
      </div>
    </div>
  );
}

export function RulePanel({ rule }: { rule: DecisionRule | null }) {
  if (!rule) {
    return (
      <div className="px-4 py-3">
        <Label>Learned decision rule</Label>
        <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
          Nothing learned yet. SecondShift stays quiet while the expert follows the runbook. It only asks, and only
          learns, when the expert&apos;s action diverges from what the runbook expects.
        </p>
      </div>
    );
  }
  const changed = new Set(rule.changedIds);
  return (
    <div>
      <Section
        title="Learned decision rule"
        aside={
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[11px] text-muted">{rule.id}</span>
            <Tag tone="rule">v{rule.version}</Tag>
          </div>
        }
      >
        <RuleCard rule={rule} />
      </Section>

      <Section title="Guardrails · when not to apply">
        <ul className="space-y-2">
          {rule.guardrails.map((g) => (
            <GuardrailRow key={g.id} g={g} changed={changed.has(g.id)} version={rule.version} />
          ))}
        </ul>
      </Section>

      <Section title="Evidence strength">
        <ConfidenceMeter rule={rule} />
      </Section>

      <Section title="Evidence">
        <ul className="space-y-2.5">
          {rule.evidence.map((e) => (
            <EvidenceItem key={e.id} e={e} />
          ))}
        </ul>
      </Section>

      <Section title="Revision history" className="border-b-0">
        <ol className="space-y-1">
          {rule.history.map((h) => (
            <li key={h.version} className="flex gap-2 text-[12px]">
              <span className="font-mono text-rule">v{h.version}</span>
              <span className="text-muted">{h.summary}</span>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}
