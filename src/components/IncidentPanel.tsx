import { SIGNALS } from "@/domain/signals";
import type { IncidentSignal, IncidentState, SignalId, SignalState } from "@/domain/types";
import { ErrorChart } from "./ErrorChart";
import { Label, Section, Tag, cx } from "./ui";

export interface SignalMark {
  tone: "diverge" | "rule" | "ok" | "bad" | "unknown";
  text: string;
}

function StateBox({ state }: { state: SignalState }) {
  if (state === "unknown") {
    return (
      <span
        title="unknown: telemetry missing"
        className="mt-[3px] grid h-3 w-3 shrink-0 place-items-center rounded-[2px] border border-dashed border-unknown font-mono text-[8px] text-unknown"
      >
        ?
      </span>
    );
  }
  return (
    <span
      title={state}
      className={cx(
        "mt-[3px] h-3 w-3 shrink-0 rounded-[2px] border",
        state === "present" ? "border-bad bg-bad/80" : "border-line-strong bg-transparent",
      )}
    />
  );
}

const KIND_TONE = {
  deploy: "text-expert",
  alert: "text-bad",
  metric: "text-muted",
  note: "text-faint",
} as const;

export function IncidentPanel({
  incident,
  signals,
  marks = {},
}: {
  incident: IncidentState;
  signals: IncidentSignal[];
  marks?: Partial<Record<SignalId, SignalMark>>;
}) {
  return (
    <div>
      <div className="border-b border-line px-4 pb-3 pt-3">
        <div className="flex items-center gap-2">
          <Tag tone="bad">{incident.severity}</Tag>
          <span className="font-mono text-[12px] text-muted">{incident.id}</span>
          <span className="ml-auto font-mono text-[11px] text-faint">{incident.clock}</span>
        </div>
        <h2 className="mt-1.5 text-[15px] font-semibold leading-snug text-text">{incident.title}</h2>
        {incident.deploy && (
          <div className="mt-1 font-mono text-[11px] text-muted">
            {incident.deploy.previousVersion} → <span className="text-expert">{incident.deploy.version}</span> ·{" "}
            {incident.deploy.rolloutPct}% rollout
          </div>
        )}
      </div>

      <Section title="Signals (derived from telemetry)">
        <ul className="space-y-1.5">
          {signals.map((s) => {
            const mark = marks[s.id];
            return (
              <li
                key={s.id}
                className={cx(
                  "flex gap-2 rounded-[3px] border px-2 py-1.5",
                  mark?.tone === "diverge" && "border-diverge/50 bg-diverge/5",
                  mark?.tone === "rule" && "border-rule/50 bg-rule/5",
                  mark?.tone === "ok" && "border-ok/40 bg-ok/5",
                  mark?.tone === "bad" && "border-bad/50 bg-bad/5",
                  mark?.tone === "unknown" && "border-dashed border-unknown/60 bg-unknown/5",
                  !mark && "border-transparent",
                )}
              >
                <StateBox state={s.state} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className={cx("leading-tight", s.state === "absent" ? "text-muted" : "text-text")}>
                      {SIGNALS[s.id].label}
                    </span>
                    {mark && <Tag tone={mark.tone} dashed={mark.tone === "unknown"}>{mark.text}</Tag>}
                  </div>
                  <div className="mt-0.5 font-mono text-[10.5px] leading-snug text-faint">{s.detail}</div>
                </div>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="5xx error rate · last 20 min">
        <ErrorChart incident={incident} />
      </Section>

      <Section title="Per-version breakdown">
        {incident.versions ? (
          <table className="w-full font-mono text-[11px]">
            <thead>
              <tr className="text-left text-faint">
                <th className="pb-1 font-normal">version</th>
                <th className="pb-1 text-right font-normal">pods</th>
                <th className="pb-1 text-right font-normal">5xx</th>
              </tr>
            </thead>
            <tbody>
              {incident.versions.map((v) => (
                <tr key={v.version} className="border-t border-line">
                  <td className="py-1">
                    <span className={v.isNew ? "text-expert" : "text-muted"}>{v.version}</span>
                    {v.isNew && <span className="ml-1.5 text-[9.5px] text-faint">NEW</span>}
                  </td>
                  <td className="py-1 text-right text-muted">{v.instances}</td>
                  <td className={cx("py-1 text-right", v.errorRatePct >= 2 ? "text-bad" : "text-muted")}>
                    {v.errorRatePct.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="rounded-[3px] border border-dashed border-unknown/60 px-2 py-1.5 font-mono text-[11px] text-unknown">
            Unavailable: version label missing from metrics
          </div>
        )}
      </Section>

      <Section title="Timeline">
        <ol className="space-y-1">
          {incident.timeline.map((e, i) => (
            <li key={i} className="flex gap-2 text-[11.5px] leading-snug">
              <span className="w-8 shrink-0 text-right font-mono text-faint">-{e.minutesAgo}m</span>
              <span className={cx("w-12 shrink-0 font-mono text-[10px] uppercase", KIND_TONE[e.kind])}>{e.kind}</span>
              <span className="text-muted">{e.text}</span>
            </li>
          ))}
        </ol>
      </Section>

      <div className="px-4 py-2">
        <Label>Seeded demo incident · not live telemetry</Label>
      </div>
    </div>
  );
}
