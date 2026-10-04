"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { ACTIONS, ACTION_ORDER } from "@/domain/actions";
import type { BoundaryMapData, Placement } from "@/domain/boundary";
import type { PolicyResult } from "@/domain/benchmark";
import type { DecisionMemory } from "@/domain/memory";
import { conditionLabel } from "@/domain/rules";
import { SCRIPTED, type TraineeCase } from "@/domain/scenarios";
import type { ExpertSession } from "@/domain/session";
import { SIGNALS, signalById } from "@/domain/signals";
import type { ActionId, CounterfactualStance, EvaluationResult, IncidentSignal, IncidentState, TranscriptSource } from "@/domain/types";
import { DecisionBoundaryMap } from "../boundary/DecisionBoundaryMap";
import { ClaimVerification } from "../ClaimVerification";
import { CounterfactualReview } from "../CounterfactualReview";
import { ErrorChart } from "../ErrorChart";
import { BenchmarkPanel, MemoryPanel } from "../Evaluation";
import type { SpeechStatus } from "../ExpertFlow";
import { EvidenceItem } from "../RulePanel";
import { VoiceAnswer } from "../VoiceAnswer";
import { Button, Label, Tag, cx } from "../ui";

export type Chapter = "before" | "surprise" | "why" | "boundary" | "transfer" | "memory";

export const CHAPTERS: { key: Chapter; label: string }[] = [
  { key: "before", label: "Before" },
  { key: "surprise", label: "Surprise" },
  { key: "why", label: "Why" },
  { key: "boundary", label: "Boundary" },
  { key: "transfer", label: "Transfer" },
  { key: "memory", label: "Memory" },
];

export function chapterUnlocked(c: Chapter, s: ExpertSession): boolean {
  if (c === "before") return true;
  if (c === "surprise" || c === "why") return Boolean(s.divergence);
  if (c === "boundary") return Boolean(s.ruleV1);
  return Boolean(s.rule);
}

export interface JudgeViewProps {
  chapter: Chapter;
  onChapter: (c: Chapter) => void;
  session: ExpertSession;
  voiceConfigured: boolean;
  speech: { why: SpeechStatus; cf: SpeechStatus };
  onReplay: (which: "why" | "cf") => void;
  extracting: string | null;
  onChoose: (a: ActionId) => void;
  onAskWhy: () => void;
  onExplain: (text: string, source: TranscriptSource) => void;
  onRetryExplain: () => void;
  onProbe: () => void;
  onAnswer: (text: string, source: TranscriptSource) => void;
  onResolveStance: (stance: CounterfactualStance, alternative: ActionId | null) => void;
  onReopenCounterfactual: () => void;
  onLoadScripted: () => void;
  map: BoundaryMapData | null;
  cases: TraineeCase[];
  activeCase: TraineeCase;
  onSelectCase: (k: TraineeCase["key"]) => void;
  traineeSignals: IncidentSignal[];
  traineeChoice: ActionId | null;
  onTraineeChoose: (a: ActionId) => void;
  evaluation: EvaluationResult | null;
  placement: Placement | null;
  benchmark: PolicyResult[] | null;
  memory: { json: string; memory: DecisionMemory } | null;
}

function Stepper({ chapter, session, onChapter }: { chapter: Chapter; session: ExpertSession; onChapter: (c: Chapter) => void }) {
  return (
    <nav aria-label="Demo chapters" className="border-b border-line bg-panel">
      <ol className="mx-auto flex max-w-[1320px] overflow-x-auto px-6">
        {CHAPTERS.map((c, i) => {
          const open = chapterUnlocked(c.key, session);
          const active = c.key === chapter;
          return (
            <li key={c.key} className="shrink-0">
              <button
                type="button"
                disabled={!open}
                onClick={() => onChapter(c.key)}
                aria-current={active ? "step" : undefined}
                className={cx(
                  "flex items-baseline gap-2 border-b-2 px-3 py-2.5 transition-colors",
                  active ? "border-rule text-text" : "border-transparent",
                  !active && open && "text-muted hover:text-text",
                  !open && "cursor-not-allowed text-faint/60",
                )}
              >
                <span className="font-mono text-[12px]">{String(i + 1).padStart(2, "0")}</span>
                <span className="text-[15px] font-medium">{c.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Chapter({ kicker, title, lead, children }: { kicker: string; title: ReactNode; lead?: ReactNode; children: ReactNode }) {
  return (
    <section className="mx-auto max-w-[1320px] px-6 pb-16 pt-6">
      <div className="font-mono text-[12px] uppercase tracking-[0.1em] text-faint">{kicker}</div>
      <h1 tabIndex={-1} className="mt-1.5 max-w-[1000px] focus:outline-none text-[30px] font-semibold leading-[1.15] tracking-tight text-text lg:text-[36px]">{title}</h1>
      {lead && <p className="mt-2 max-w-[820px] text-[17px] leading-relaxed text-muted">{lead}</p>}
      <div className="mt-6">{children}</div>
    </section>
  );
}

function Next({ onClick, children, disabled }: { onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 rounded-[3px] border border-rule bg-rule/15 px-4 py-2.5 text-[16px] font-medium text-text transition-colors hover:bg-rule/25 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
      <span aria-hidden>→</span>
    </button>
  );
}

function SpeechNote({ status, onReplay }: { status: SpeechStatus; onReplay: () => void }) {
  if (status === "idle") return null;
  const text: Record<Exclude<SpeechStatus, "idle">, string> = {
    speaking: "Speaking via ElevenLabs…",
    played: "Asked aloud · ElevenLabs TTS",
    unavailable: "Voice output off · text only",
    failed: "ElevenLabs TTS failed · text only",
  };
  return (
    <div className="mt-2 flex items-center gap-3 font-mono text-[12px]">
      <span className={status === "played" || status === "speaking" ? "text-expert" : "text-faint"}>{text[status]}</span>
      {(status === "played" || status === "failed") && (
        <button type="button" onClick={onReplay} className="text-muted underline-offset-2 hover:text-text hover:underline">
          {status === "failed" ? "retry" : "replay"}
        </button>
      )}
    </div>
  );
}

function Stat({ label, value, tone = "text" }: { label: string; value: ReactNode; tone?: "text" | "bad" | "expert" }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className={cx("mt-0.5 font-mono text-[20px] font-semibold leading-tight", tone === "bad" ? "text-bad" : tone === "expert" ? "text-expert" : "text-text")}>
        {value}
      </div>
    </div>
  );
}

function SignalList({ signals, highlight }: { signals: IncidentSignal[]; highlight?: Set<string> }) {
  return (
    <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
      {signals.map((s) => (
        <li
          key={s.id}
          className={cx(
            "flex items-start gap-2 rounded-[3px] border px-2 py-1.5",
            highlight?.has(s.id) ? "border-diverge/60 bg-diverge/[0.07]" : "border-transparent",
          )}
        >
          <span
            aria-hidden
            className={cx(
              "mt-[5px] h-2.5 w-2.5 shrink-0 rounded-[2px] border",
              s.state === "present" ? "border-bad bg-bad/80" : s.state === "unknown" ? "border-dashed border-unknown" : "border-line-strong",
            )}
          />
          <div className="min-w-0">
            <div className={cx("text-[14px] leading-snug", s.state === "absent" ? "text-muted" : "text-text")}>
              {SIGNALS[s.id].label}
              <span className="sr-only">: {s.state}</span>
              {s.state === "unknown" && <span className="ml-1 font-mono text-[11px] text-unknown">unknown</span>}
            </div>
            <div className="font-mono text-[11px] leading-snug text-faint">{s.detail}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function IncidentSummary({
  incident,
  signals,
  highlight,
  compact = false,
}: {
  incident: IncidentState;
  signals: IncidentSignal[];
  highlight?: Set<string>;
  compact?: boolean;
}) {
  return (
    <div className="border border-line bg-panel">
      <div className="border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <Tag tone="bad">{incident.severity}</Tag>
          <span className="font-mono text-[13px] text-muted">{incident.id}</span>
          <span className="ml-auto font-mono text-[12px] text-faint">{incident.clock}</span>
        </div>
        <div className="mt-1.5 text-[21px] font-semibold leading-snug text-text">{incident.title}</div>
      </div>
      <div className="grid grid-cols-3 gap-4 border-b border-line px-4 py-3">
        <Stat label="5xx rate" value={`${incident.errorRatePct.baseline}% → ${incident.errorRatePct.current}%`} tone="bad" />
        <Stat label="p99 latency" value={`${incident.p99LatencyMs.baseline} → ${incident.p99LatencyMs.current}ms`} />
        <Stat
          label="Deploy"
          value={incident.deploy ? `${incident.deploy.version}` : "none"}
          tone={incident.deploy ? "expert" : "text"}
        />
      </div>
      {!compact && (
        <div className="border-b border-line px-4 py-3">
          <Label className="mb-1">5xx error rate · last 20 min</Label>
          <ErrorChart incident={incident} wide />
        </div>
      )}
      <div className="px-3 py-3">
        <Label className="mb-1.5 px-1">Signals derived from telemetry by code</Label>
        <SignalList signals={signals} highlight={highlight} />
      </div>
      <div className="border-t border-line px-4 py-2">
        <Label>Seeded demo incident · not live telemetry</Label>
      </div>
    </div>
  );
}

function ActionButtons({ onChoose, chosen, runbook, large }: { onChoose: (a: ActionId) => void; chosen: ActionId | null; runbook: ActionId; large?: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {ACTION_ORDER.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onChoose(id)}
          aria-pressed={chosen === id}
          className={cx(
            "flex items-center justify-between rounded-[3px] border px-3.5 py-2.5 text-left font-medium transition-colors",
            large ? "text-[16px]" : "text-[14px]",
            chosen === id ? "border-text bg-text/10 text-text" : "border-line-strong bg-raised text-text hover:border-expert hover:bg-expert/10",
          )}
        >
          {ACTIONS[id].label}
          {id === runbook && <span className="font-mono text-[11px] text-faint">runbook</span>}
        </button>
      ))}
    </div>
  );
}

function ChapterBefore(p: JudgeViewProps) {
  const s = p.session;
  const exp = ACTIONS[s.expected.action];
  const ignored = s.signals.filter((x) => x.state === "present" && !s.expected.usedSignals.includes(x.id));
  return (
    <Chapter
      kicker="01 · Before"
      title={<>The runbook says <span className="text-expected">{exp.label.toLowerCase()}</span>.</>}
      lead={`${s.incident.service} is failing. SecondShift first predicts what the playbook would do, so it can notice when an expert does something else.`}
    >
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <IncidentSummary incident={s.incident} signals={s.signals} />
        <div className="space-y-6">
          <div className="border border-expected/30 bg-raised px-5 py-4">
            <Label>Runbook prediction</Label>
            <div className="mt-1 text-[36px] font-semibold leading-tight text-expected">{exp.label}</div>
            <div className="mt-1 font-mono text-[13px] text-muted">
              {s.expected.step.id} · {s.expected.step.when}
            </div>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[15px] leading-relaxed">
              <dt className="text-faint">Reads</dt>
              <dd className="text-text">{s.expected.usedSignals.map((id) => SIGNALS[id].label).join(", ") || "nothing"}</dd>
              <dt className="text-faint">Ignores</dt>
              <dd className="text-muted">{ignored.map((x) => SIGNALS[x.id].label).join(" · ") || "nothing else abnormal"}</dd>
            </dl>
          </div>
          <div>
            <div className="mb-2 text-[17px] font-medium text-text">What did the on-call expert actually do?</div>
            <ActionButtons onChoose={p.onChoose} chosen={s.chosen} runbook={s.expected.action} large />
            {s.chosen && !s.divergence && (
              <p className="mt-3 border-l-2 border-line-strong pl-3 text-[15px] leading-relaxed text-muted">
                The expert followed the runbook. There is no hidden judgment here, so SecondShift does not interrupt and learns nothing.
                Pick a different action to see what happens when the expert deviates.
              </p>
            )}
          </div>
        </div>
      </div>
    </Chapter>
  );
}

function ChapterSurprise(p: JudgeViewProps) {
  const d = p.session.divergence!;
  const exp = ACTIONS[d.expected.action];
  const act = ACTIONS[d.actual.action];
  return (
    <Chapter
      kicker="02 · Surprise"
      title={<>The expert <span className="text-expert">{act.past}</span> instead.</>}
      lead="That difference is the knowledge. The runbook cannot explain it. Only the expert can."
    >
      <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <div className="border border-expected/30 bg-raised px-5 py-5">
          <Label>Runbook expected · {d.expected.step.id}</Label>
          <div className="mt-1 text-[34px] font-semibold leading-tight text-expected">{exp.label}</div>
        </div>
        <div className="flex items-center justify-center px-2">
          <span className="font-mono text-[56px] font-semibold leading-none text-diverge" aria-label="differs from">
            ≠
          </span>
        </div>
        <div className="border border-expert/60 bg-expert/[0.07] px-5 py-5">
          <Label>Expert did</Label>
          <div className="mt-1 text-[34px] font-semibold leading-tight text-expert">{act.label}</div>
        </div>
      </div>

      <div className="mt-7 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div>
          <div className="mb-2 text-[17px] font-medium text-text">On screen, but not in the runbook</div>
          <ul className="space-y-2">
            {d.ignoredSignals.map((id) => (
              <li key={id} className="flex items-baseline justify-between gap-3 border border-diverge/50 bg-diverge/[0.07] px-3.5 py-2.5">
                <span className="text-[16px] text-text">{SIGNALS[id].label}</span>
                <span className="font-mono text-[12px] text-muted">{signalById(p.session.signals, id)?.detail}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-2 text-[17px] font-medium text-text">Why SecondShift asks now</div>
          <p className="text-[15px] leading-relaxed text-muted">{d.reason}</p>
        </div>
      </div>

      <div className="mt-8">
        <Next onClick={p.onAskWhy}>Ask the expert why</Next>
      </div>
    </Chapter>
  );
}

function ChapterWhy(p: JudgeViewProps) {
  const s = p.session;
  const d = s.divergence!;
  return (
    <Chapter kicker="03 · Why · ElevenLabs voice" title={<>&ldquo;{d.question}&rdquo;</>}>
      <div className="-mt-5 mb-6">
        <SpeechNote status={p.speech.why} onReplay={() => p.onReplay("why")} />
      </div>
      {!s.explanation ? (
        <div className="max-w-[900px]">
          <VoiceAnswer
            key={`judge-why-${s.chosen}`}
            large
            voiceConfigured={p.voiceConfigured}
            scripted={[
              { label: "Use scripted answer", text: SCRIPTED.explanation },
              { label: "Try a vague answer", text: SCRIPTED.vagueExplanation },
            ]}
            submitLabel="Learn from this answer"
            busy={p.extracting}
            placeholder="e.g. The failures started right after the deploy and only the new version is affected…"
            onSubmit={p.onExplain}
          />
        </div>
      ) : (
        s.extraction && (
          <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
            <ClaimVerification
              explanation={s.explanation}
              extraction={s.extraction}
              signals={s.signals}
              incidentId={s.incident.id}
              rejected={s.expected.action}
              large
            />
            <div>
              {s.ruleV1 ? (
                <div className="border border-rule/60 bg-rule/[0.07] px-4 py-4">
                  <Label className="!text-rule">Rule v1 learned</Label>
                  <ul className="mt-2 space-y-1.5">
                    {s.ruleV1.conditions.map((c, i) => (
                      <li key={c.id} className="text-[15px] text-text">
                        <span className="mr-2 font-mono text-[12px] text-rule">{i === 0 ? "IF" : "AND"}</span>
                        {conditionLabel(c)}
                      </li>
                    ))}
                    <li className="pt-1 text-[16px] font-semibold text-expert">
                      <span className="mr-2 font-mono text-[12px] text-rule">THEN</span>
                      {ACTIONS[s.ruleV1.action].label}
                    </li>
                  </ul>
                  <p className="mt-3 text-[13px] leading-relaxed text-muted">
                    Only the {s.ruleV1.conditions.length} supported claims became conditions. Nothing else was learned.
                  </p>
                  <div className="mt-4">
                    <Next onClick={p.onProbe}>Probe the boundary</Next>
                  </div>
                </div>
              ) : (
                <div className="border border-dashed border-unknown/70 bg-unknown/5 px-4 py-4">
                  <div className="font-mono text-[12px] uppercase tracking-wider text-unknown">No rule learned</div>
                  <p className="mt-2 text-[15px] leading-relaxed text-text">
                    Nothing in this answer points at something observable in the incident. SecondShift will not invent a reason
                    the expert did not give.
                  </p>
                  <div className="mt-3">
                    <Button onClick={p.onRetryExplain}>Answer again</Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      )}
    </Chapter>
  );
}

function ChapterBoundary(p: JudgeViewProps) {
  const s = p.session;
  const cf = s.counterfactual;
  const v1 = s.ruleV1!;
  const rule = s.rule ?? v1;
  return (
    <Chapter
      kicker="04 · Learned boundary"
      title="What would change the expert's mind?"
      lead="Columns are the reasons the expert gave. Rows ask the rule engine what it recommends if one reason stops being true, or cannot be measured."
    >
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_400px]">
        <div>{p.map && <DecisionBoundaryMap map={p.map} rule={rule} />}</div>

        {cf && (
          <aside className="border border-expert/40 bg-panel px-4 py-4" aria-label="Counterfactual probe">
            <Label className="!text-expert">Counterfactual probe · ElevenLabs voice</Label>
            <p className="mt-2 text-[20px] font-medium leading-snug text-text">&ldquo;{cf.question}&rdquo;</p>
            <SpeechNote status={p.speech.cf} onReplay={() => p.onReplay("cf")} />
            {!s.draft && <p className="mt-2 text-[13px] leading-relaxed text-muted">{cf.rationale}</p>}
            <div className="mt-3 border border-line-strong bg-raised px-3 py-2">
              <Label>Hypothetical vs {s.incident.id}</Label>
              <ul className="mt-1 space-y-0.5 font-mono text-[12px]">
                {cf.hypothetical.map((h) => (
                  <li key={h.signal} className="flex justify-between gap-2">
                    <span className="font-sans text-[13px] text-text">{SIGNALS[h.signal].label}</span>
                    <span className={h.from === h.to ? "text-muted" : "text-diverge"}>
                      {h.from === "present" ? "yes" : "no"} → {h.to === "present" ? "yes" : "no"}
                      {h.from === h.to ? " (held)" : " (flipped)"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-4">
              {!s.draft ? (
                <VoiceAnswer
                  key={`judge-cf-${v1.version}-${s.explanation?.text}`}
                  voiceConfigured={p.voiceConfigured}
                  scripted={[{ label: "Use scripted answer", text: SCRIPTED.counterfactualAnswer }]}
                  submitLabel="Submit answer"
                  placeholder="e.g. No. I would investigate first…"
                  onSubmit={p.onAnswer}
                />
              ) : (
                <div className="space-y-3">
                  <CounterfactualReview
                    key={`${s.draft.source}:${s.draft.text}`}
                    draft={s.draft}
                    answer={s.answer}
                    ruleAction={v1.action}
                    onConfirm={p.onResolveStance}
                    onReopen={p.onReopenCounterfactual}
                    large
                  />
                  {s.answer && (
                    <>
                      <div className="border border-rule/60 bg-rule/[0.07] px-3 py-3">
                        <div className="font-mono text-[14px] text-text">
                          Rule v{v1.version} → <span className="text-rule">v{rule.version}</span>
                        </div>
                        <p className="mt-1 text-[14px] leading-relaxed text-text">{rule.history.at(-1)?.summary}.</p>
                        <p className="mt-1 font-mono text-[12px] text-muted">
                          evidence strength {v1.confidence.score.toFixed(2)} → {rule.confidence.score.toFixed(2)} (heuristic, capped at{" "}
                          {rule.confidence.cap}: one incident)
                        </p>
                      </div>
                      <Next onClick={() => p.onChapter("transfer")}>Test on incidents the expert never saw</Next>
                    </>
                  )}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </Chapter>
  );
}

const VERDICT_STYLE = {
  mismatch: { mark: "✕", box: "border-bad/70 bg-bad/[0.08]", text: "text-bad" },
  aligned: { mark: "✓", box: "border-ok/60 bg-ok/[0.07]", text: "text-ok" },
  uncertain: { mark: "?", box: "border-dashed border-unknown/80 bg-unknown/[0.06]", text: "text-unknown" },
  outside_rule: { mark: "–", box: "border-line-strong bg-raised", text: "text-muted" },
} as const;

function ChapterTransfer(p: JudgeViewProps) {
  const rule = p.session.rule!;
  const inc = p.activeCase.incident;
  const ev = p.evaluation;
  return (
    <Chapter
      kicker="05 · Transfer"
      title="A trainee, on an incident the expert never saw."
      lead="Different service, different numbers. The trainee picks an action; SecondShift grades it against the expert's rule and shows where the verdict came from."
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4" role="tablist" aria-label="Trainee incidents">
        {p.cases.map((c) => (
          <button
            key={c.key}
            type="button"
            role="tab"
            aria-selected={c.key === p.activeCase.key}
            onClick={() => p.onSelectCase(c.key)}
            className={cx(
              "border px-3.5 py-2.5 text-left transition-colors",
              c.key === p.activeCase.key ? "border-text/70 bg-raised" : "border-line hover:border-line-strong",
            )}
          >
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[13px] text-muted">{c.key}</span>
              <span className="text-[15px] font-medium text-text">{c.incident.service}</span>
            </div>
            <div className="mt-0.5 text-[13px] leading-snug text-faint">{c.tests}</div>
          </button>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-5">
          <IncidentSummary incident={inc} signals={p.traineeSignals} compact />
        </div>
        <div className="space-y-5">
          <div>
            <div className="mb-2 text-[17px] font-medium text-text">Trainee on call for {inc.id}: what do you do?</div>
            <ActionButtons onChoose={p.onTraineeChoose} chosen={p.traineeChoice} runbook={ev?.expected.action ?? "restart_service"} />
          </div>
          {ev && (
            <>
              <div className={cx("border px-4 py-4", VERDICT_STYLE[ev.verdict].box)}>
                <div className={cx("flex items-center gap-2 text-[22px] font-semibold", VERDICT_STYLE[ev.verdict].text)}>
                  <span className="font-mono">{VERDICT_STYLE[ev.verdict].mark}</span>
                  {ev.headline}
                </div>
                <p className="mt-2 text-[15px] leading-relaxed text-text">{ev.explanation}</p>
              </div>
              <div className="grid grid-cols-3 border border-line">
                <div className="border-r border-line px-3 py-2.5">
                  <Label>Runbook</Label>
                  <div className="mt-1 text-[16px] font-semibold text-expected">{ACTIONS[ev.expected.action].label}</div>
                </div>
                <div className="border-r border-line px-3 py-2.5">
                  <Label>Expert rule v{rule.version}</Label>
                  <div className={cx("mt-1 text-[16px] font-semibold", ev.match.recommended ? "text-rule" : "text-muted")}>
                    {ev.match.recommended
                      ? ACTIONS[ev.match.recommended].label
                      : ev.match.outcome === "uncertain"
                        ? "Verify first"
                        : ev.match.outcome === "guardrail"
                          ? `Not ${ACTIONS[rule.action].label.toLowerCase()}`
                          : "No opinion"}
                  </div>
                </div>
                <div className="px-3 py-2.5">
                  <Label>Trainee</Label>
                  <div className={cx("mt-1 text-[16px] font-semibold", VERDICT_STYLE[ev.verdict].text)}>{ACTIONS[ev.trainee.action].label}</div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {ev && p.map && (
        <div className="mt-8 grid grid-cols-1 gap-8 2xl:grid-cols-[minmax(0,1fr)_380px]">
          <div>
            <div className="mb-2 text-[17px] font-medium text-text">Where {inc.id} lands on the learned boundary</div>
            <DecisionBoundaryMap map={p.map} rule={rule} placement={p.placement} incidentId={inc.id} size="compact" />
          </div>
          <div>
            <div className="mb-2 text-[17px] font-medium text-text">Where the verdict came from</div>
            <p className="mb-3 text-[13px] text-muted">The expert, on {rule.sourceIncidentId}. Every source is labelled.</p>
            <ul className="space-y-3">
              {ev.provenance
                .filter((e) => e.kind !== "signal")
                .map((e) => (
                  <EvidenceItem key={e.id} e={e} />
                ))}
            </ul>
          </div>
        </div>
      )}

      <div className="mt-8">
        <Next onClick={() => p.onChapter("memory")}>Same judgment, machine-readable</Next>
      </div>
    </Chapter>
  );
}

function ChapterMemory(p: JudgeViewProps) {
  return (
    <Chapter
      kicker="06 · Decision memory"
      title="The same judgment can train the next engineer, or become context for an enterprise agent."
      lead="The rule that just coached the trainee is a versioned, machine-readable artifact. An evaluator that reads only that file runs it on 14 seeded incidents."
    >
      <div className="grid grid-cols-1 gap-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <div className="mb-3 text-[17px] font-medium text-text">Runbook alone vs runbook + decision memory</div>
          {p.benchmark && <BenchmarkPanel results={p.benchmark} large />}
        </div>
        <div>
          <div className="mb-3 text-[17px] font-medium text-text">Agent-ready decision memory</div>
          {p.memory && <MemoryPanel json={p.memory.json} memory={p.memory.memory} large />}
        </div>
      </div>
    </Chapter>
  );
}

function NeedsRule({ onLoadScripted, onChapter }: { onLoadScripted: () => void; onChapter: (c: Chapter) => void }) {
  return (
    <Chapter kicker="Not yet" title="Nothing has been learned yet." lead="Teach the rule in the expert chapters first, or load the scripted expert session (labelled as scripted everywhere).">
      <div className="flex flex-wrap gap-3">
        <Next onClick={() => onChapter("before")}>Start the expert shift</Next>
        <Button onClick={onLoadScripted}>Load scripted expert session</Button>
      </div>
    </Chapter>
  );
}

export function JudgeView(p: JudgeViewProps) {
  const open = chapterUnlocked(p.chapter, p.session);
  const pane = useRef<HTMLDivElement>(null);
  const firstChapter = useRef(true);

  // A new chapter always opens at its heading. Reset the chapter pane and, on
  // narrow screens where the page itself scrolls, the window; once more on the
  // next frame to absorb scroll momentum carried over from the click. Focus
  // moves to the heading (without scrolling) so keyboard and screen-reader
  // users start at the top of the new chapter too.
  useLayoutEffect(() => {
    const reset = () => {
      pane.current?.scrollTo({ top: 0 });
      if (window.scrollY > 0) window.scrollTo({ top: 0 });
    };
    reset();
    const frame = requestAnimationFrame(reset);
    if (firstChapter.current) firstChapter.current = false;
    else pane.current?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
    return () => cancelAnimationFrame(frame);
  }, [p.chapter]);
  let body: ReactNode;
  if (!open) body = <NeedsRule onLoadScripted={p.onLoadScripted} onChapter={p.onChapter} />;
  else if (p.chapter === "before") body = <ChapterBefore {...p} />;
  else if (p.chapter === "surprise") body = <ChapterSurprise {...p} />;
  else if (p.chapter === "why") body = <ChapterWhy {...p} />;
  else if (p.chapter === "boundary") body = <ChapterBoundary {...p} />;
  else if (p.chapter === "transfer") body = <ChapterTransfer {...p} />;
  else body = <ChapterMemory {...p} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Stepper chapter={p.chapter} session={p.session} onChapter={p.onChapter} />
      <div ref={pane} className="judge pane min-h-0 flex-1 overflow-y-auto [overflow-anchor:none]" key={p.chapter}>
        {body}
      </div>
    </div>
  );
}
