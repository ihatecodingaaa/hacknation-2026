"use client";

import { useState, type ReactNode } from "react";
import { ACTIONS, ACTION_ORDER } from "@/domain/actions";
import { SCRIPTED } from "@/domain/scenarios";
import type { ExpertSession } from "@/domain/session";
import { SIGNALS } from "@/domain/signals";
import type { ActionId, Citation, CounterfactualStance, SignalState, TranscriptSource } from "@/domain/types";
import { VoiceAnswer } from "./VoiceAnswer";
import { Button, Label, SourceTag, Tag, cx } from "./ui";

export type SpeechStatus = "idle" | "speaking" | "played" | "unavailable" | "failed";

function Step({
  n,
  title,
  tone = "muted",
  aside,
  children,
}: {
  n: string;
  title: string;
  tone?: "muted" | "diverge" | "rule" | "expert";
  aside?: ReactNode;
  children: ReactNode;
}) {
  const rail: Record<string, string> = {
    muted: "border-line-strong",
    diverge: "border-diverge",
    rule: "border-rule",
    expert: "border-expert",
  };
  const text: Record<string, string> = {
    muted: "text-faint",
    diverge: "text-diverge",
    rule: "text-rule",
    expert: "text-expert",
  };
  return (
    <section id={`step-${n}`} className={cx("scroll-mt-4 border-l-2 pl-4", rail[tone])}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className={cx("font-mono text-[10.5px] font-medium uppercase tracking-[0.08em]", text[tone])}>
          <span className="mr-2 opacity-70">{n}</span>
          {title}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

function SpeechLine({ status, onReplay }: { status: SpeechStatus; onReplay: () => void }) {
  if (status === "idle") return null;
  const text: Record<Exclude<SpeechStatus, "idle">, string> = {
    speaking: "Speaking via ElevenLabs…",
    played: "Asked aloud · ElevenLabs TTS",
    unavailable: "Voice output off · text only",
    failed: "ElevenLabs TTS failed · text only",
  };
  return (
    <div className="flex items-center gap-2 font-mono text-[10.5px]">
      <span className={status === "played" || status === "speaking" ? "text-expert" : "text-faint"}>
        {text[status]}
      </span>
      {(status === "played" || status === "failed") && (
        <button type="button" onClick={onReplay} className="text-muted underline-offset-2 hover:text-text hover:underline">
          {status === "failed" ? "retry" : "replay"}
        </button>
      )}
    </div>
  );
}

function stateWord(s: SignalState | "present" | "absent"): string {
  return s === "present" ? "yes" : s === "absent" ? "no" : "unknown";
}

function Highlighted({ text, citations }: { text: string; citations: Citation[] }) {
  const parts: ReactNode[] = [];
  let at = 0;
  citations.forEach((c, i) => {
    if (c.start > at) parts.push(text.slice(at, c.start));
    parts.push(
      <mark
        key={i}
        title={`${SIGNALS[c.signal].label}: ${c.grounded ? "confirmed by telemetry" : "not supported by telemetry"}`}
        className={cx(
          "rounded-[2px] px-0.5 text-text",
          c.grounded ? "bg-rule/20 underline decoration-rule underline-offset-[3px]" : "bg-bad/15 line-through decoration-bad",
        )}
      >
        {text.slice(c.start, c.end)}
      </mark>,
    );
    at = c.end;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <p className="text-[14px] leading-relaxed text-text">{parts}</p>;
}

function ActionChooser({
  expected,
  onChoose,
}: {
  expected: ActionId;
  onChoose: (a: ActionId) => void;
}) {
  return (
    <div className="grid gap-1.5">
      {ACTION_ORDER.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onChoose(id)}
          className="flex items-center justify-between rounded-[3px] border border-line-strong bg-raised px-2.5 py-1.5 text-left text-[13px] text-text transition-colors hover:border-expert hover:bg-expert/10"
        >
          {ACTIONS[id].label}
          {id === expected && <span className="font-mono text-[10px] text-faint">runbook</span>}
        </button>
      ))}
    </div>
  );
}

export function ExpertFlow({
  session: s,
  voiceConfigured,
  speech,
  onChoose,
  onExplain,
  onRetryExplain,
  onAnswer,
  onResolveStance,
  onReplay,
  onGoTrainee,
}: {
  session: ExpertSession;
  voiceConfigured: boolean;
  speech: { why: SpeechStatus; cf: SpeechStatus };
  onChoose: (a: ActionId) => void;
  onExplain: (text: string, source: TranscriptSource) => void;
  onRetryExplain: () => void;
  onAnswer: (text: string, source: TranscriptSource) => void;
  onResolveStance: (stance: CounterfactualStance, alternative: ActionId | null) => void;
  onReplay: (which: "why" | "cf") => void;
  onGoTrainee: () => void;
}) {
  const [altPick, setAltPick] = useState<ActionId>("investigate");
  const exp = ACTIONS[s.expected.action];
  const diverged = Boolean(s.divergence);
  const ruleAction = s.ruleV1 ? ACTIONS[s.ruleV1.action] : null;

  return (
    <div className="space-y-6 px-5 py-4">
      {/* 01 + 02: expected vs actual */}
      <div className="grid grid-cols-1 gap-4 @xl:grid-cols-[1fr_auto_1fr]">
        <Step n="01" title="Runbook expects">
          <div className="rounded-[3px] border border-expected/30 bg-raised px-3 py-2.5">
            <div className="text-[17px] font-semibold text-expected">{exp.label}</div>
            <div className="mt-1 font-mono text-[11px] text-muted">
              {s.expected.step.id} · {s.expected.step.when}
            </div>
            <div className="mt-2 text-[11.5px] leading-snug text-faint">
              Looked at:{" "}
              {s.expected.usedSignals.length
                ? s.expected.usedSignals.map((id) => SIGNALS[id].label.toLowerCase()).join(", ")
                : "nothing"}
              . Ignores deploy timing and version scope.
            </div>
          </div>
        </Step>

        <div className="hidden items-center @xl:flex">
          <span
            className={cx(
              "font-mono text-[22px] font-semibold",
              !s.chosen ? "text-faint" : diverged ? "text-diverge" : "text-ok",
            )}
            aria-label={!s.chosen ? "pending" : diverged ? "differs from" : "matches"}
          >
            {!s.chosen ? "?" : diverged ? "≠" : "="}
          </span>
        </div>

        <Step n="02" title="Expert action" tone={s.chosen ? "expert" : "muted"}>
          {s.chosen ? (
            <div className="rounded-[3px] border border-expert/50 bg-expert/5 px-3 py-2.5">
              <div className="text-[17px] font-semibold text-expert">{ACTIONS[s.chosen].label}</div>
              <div className="mt-1 font-mono text-[11px] text-muted">chosen by the on-call expert</div>
              <div className="mt-2">
                <ChangeAction expected={s.expected.action} onChoose={onChoose} />
              </div>
            </div>
          ) : (
            <div>
              <p className="mb-2 text-[12px] text-muted">What did the on-call expert actually do?</p>
              <ActionChooser expected={s.expected.action} onChoose={onChoose} />
            </div>
          )}
        </Step>
      </div>

      {s.chosen && !diverged && (
        <Step n="03" title="No divergence" tone="muted">
          <p className="text-[13px] text-muted">
            The expert followed the runbook ({s.expected.step.id}). There is no hidden judgment to capture here, so
            SecondShift does not interrupt. Pick a different action to see what happens when the expert deviates.
          </p>
        </Step>
      )}

      {s.divergence && (
        <Step n="03" title="Decision divergence" tone="diverge">
          <div className="rounded-[3px] border border-diverge/60 bg-diverge/[0.07] px-3 py-3">
            <div className="flex flex-wrap items-center gap-2 text-[14px]">
              <span className="text-expected">{exp.label}</span>
              <span className="font-mono text-diverge">→</span>
              <span className="font-semibold text-expert">{ACTIONS[s.divergence.actual.action].label}</span>
            </div>
            <div className="mt-2">
              <Label className="!text-diverge/80">Why SecondShift is asking</Label>
              <p className="mt-1 text-[12.5px] leading-relaxed text-text">{s.divergence.reason}</p>
            </div>
            {s.divergence.ignoredSignals.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {s.divergence.ignoredSignals.map((id) => (
                  <Tag key={id} tone="diverge">
                    {SIGNALS[id].label}
                  </Tag>
                ))}
              </div>
            )}
          </div>
        </Step>
      )}

      {s.divergence && (
        <Step
          n="04"
          title="Ask why"
          tone="expert"
          aside={<SpeechLine status={speech.why} onReplay={() => onReplay("why")} />}
        >
          <p className="mb-3 text-[16px] font-medium leading-snug text-text">&ldquo;{s.divergence.question}&rdquo;</p>
          {s.explanation ? (
            <div className="flex items-center gap-2">
              <SourceTag source={s.explanation.source} />
              <span className="text-[11.5px] text-faint">answer captured</span>
            </div>
          ) : (
            <VoiceAnswer
              key={`why-${s.chosen}`}
              voiceConfigured={voiceConfigured}
              scripted={[
                { label: "Use scripted answer", text: SCRIPTED.explanation },
                { label: "Try a vague answer", text: SCRIPTED.vagueExplanation },
              ]}
              submitLabel="Learn from this answer"
              placeholder="e.g. The failures started right after the deploy and only the new version is affected…"
              onSubmit={onExplain}
            />
          )}
        </Step>
      )}

      {s.explanation && s.extraction && (
        <Step n="05" title="What SecondShift heard" tone={s.extraction.status === "grounded" ? "rule" : "diverge"}>
          <Highlighted text={s.explanation.text} citations={s.extraction.citations} />

          {s.extraction.citations.length > 0 && (
            <table className="mt-3 w-full text-[12px]">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-faint">
                  <th className="pb-1 pr-2 font-normal">phrase</th>
                  <th className="pb-1 pr-2 font-normal">signal</th>
                  <th className="pb-1 pr-2 font-normal">expert says</th>
                  <th className="pb-1 pr-2 font-normal">telemetry</th>
                  <th className="pb-1 text-right font-normal">result</th>
                </tr>
              </thead>
              <tbody>
                {s.extraction.citations.map((c, i) => (
                  <tr key={i} className="border-t border-line align-top">
                    <td className="py-1.5 pr-2 italic text-muted">&ldquo;{c.quote}&rdquo;</td>
                    <td className="py-1.5 pr-2 text-text">{SIGNALS[c.signal].label}</td>
                    <td className="py-1.5 pr-2 font-mono text-muted">{stateWord(c.claimed)}</td>
                    <td className={cx("py-1.5 pr-2 font-mono", c.observed === "unknown" ? "text-unknown" : "text-muted")}>
                      {stateWord(c.observed)}
                    </td>
                    <td className="py-1.5 text-right">
                      {c.grounded ? (
                        <Tag tone="rule">{c.claimed === "present" ? "learned" : "learned (not)"}</Tag>
                      ) : c.observed === "unknown" ? (
                        <Tag tone="unknown" dashed>
                          unverifiable
                        </Tag>
                      ) : (
                        <Tag tone="bad">contradicted</Tag>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {s.extraction.rejectionQuote && (
            <div className="mt-3 text-[12px] text-muted">
              Why not <span className="text-expected">{exp.label.toLowerCase()}</span>:{" "}
              <span className="italic text-text">&ldquo;{s.extraction.rejectionQuote}&rdquo;</span>
            </div>
          )}

          {s.extraction.status === "grounded" ? (
            <p className="mt-3 text-[12px] text-rule">
              Rule v1 created from {s.ruleV1?.conditions.length} grounded condition
              {s.ruleV1?.conditions.length === 1 ? "" : "s"}. See the right panel.
            </p>
          ) : (
            <div className="mt-3 rounded-[3px] border border-dashed border-unknown/70 bg-unknown/5 px-3 py-2.5">
              <div className="font-mono text-[11px] uppercase tracking-wider text-unknown">No rule learned</div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-text">
                This answer does not point at anything observable in the incident. SecondShift will not invent a
                reason the expert did not give. Ask the expert to name what they saw.
              </p>
              <div className="mt-2">
                <Button onClick={onRetryExplain}>Answer again</Button>
              </div>
            </div>
          )}
        </Step>
      )}

      {s.ruleV1 && s.counterfactual && ruleAction && (
        <Step
          n="06"
          title="Counterfactual probe"
          tone="expert"
          aside={<SpeechLine status={speech.cf} onReplay={() => onReplay("cf")} />}
        >
          <p className="mb-2 text-[16px] font-medium leading-snug text-text">&ldquo;{s.counterfactual.question}&rdquo;</p>
          <p className="mb-3 text-[12px] leading-relaxed text-muted">{s.counterfactual.rationale}</p>

          <div className="mb-3 rounded-[3px] border border-line-strong bg-raised px-3 py-2">
            <Label>Hypothetical incident vs {s.incident.id}</Label>
            <table className="mt-1.5 w-full font-mono text-[11.5px]">
              <tbody>
                {s.counterfactual.hypothetical.map((h) => (
                  <tr key={h.signal}>
                    <td className="py-0.5 pr-3 font-sans text-[12.5px] text-text">{SIGNALS[h.signal].label}</td>
                    <td className="py-0.5 pr-2 text-muted">{stateWord(h.from)}</td>
                    <td className="py-0.5 pr-2 text-faint">→</td>
                    <td className={cx("py-0.5", h.from === h.to ? "text-muted" : "text-diverge")}>
                      {stateWord(h.to)}
                      {h.from === h.to ? " (held)" : " (flipped)"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-1 text-[11px] text-faint">Every other signal unchanged.</div>
          </div>

          {!s.draft ? (
            <VoiceAnswer
              key={`cf-${s.ruleV1.version}-${s.explanation?.text}`}
              voiceConfigured={voiceConfigured}
              scripted={[{ label: "Use scripted answer", text: SCRIPTED.counterfactualAnswer }]}
              submitLabel="Update the rule"
              placeholder="e.g. No. I would investigate first, latency alone is not enough evidence…"
              onSubmit={onAnswer}
            />
          ) : (
            <div className="space-y-2">
              <div className="border-l-2 border-line-strong pl-2.5">
                <p className="text-[13px] italic text-text">&ldquo;{s.draft.text}&rdquo;</p>
                <div className="mt-1">
                  <SourceTag source={s.draft.source} />
                </div>
              </div>
              {s.answer ? (
                <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                  <span className="text-muted">Read as:</span>
                  {s.answer.stance === "switch" ? (
                    <Tag tone="diverge">no, would not {ruleAction.verb}</Tag>
                  ) : (
                    <Tag tone="rule">yes, would still {ruleAction.verb}</Tag>
                  )}
                  {s.answer.alternative && <Tag tone="expert">instead: {ACTIONS[s.answer.alternative].label}</Tag>}
                  <Button
                    tone="ghost"
                    onClick={() =>
                      onResolveStance(
                        s.answer?.stance === "switch" ? "still" : "switch",
                        s.answer?.stance === "switch" ? null : (s.draft?.alternative ?? null),
                      )
                    }
                  >
                    Misread? Flip it
                  </Button>
                </div>
              ) : (
                <div className="rounded-[3px] border border-dashed border-unknown/70 bg-unknown/5 px-3 py-2.5">
                  <div className="text-[12.5px] text-text">
                    SecondShift could not tell whether that is a yes or a no, so it will not guess. Expert, which is it?
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button tone="rule" onClick={() => onResolveStance("still", null)}>
                      Yes, still {ruleAction.verb}
                    </Button>
                    <span className="text-faint">or</span>
                    <Button tone="primary" onClick={() => onResolveStance("switch", altPick)}>
                      No, I would
                    </Button>
                    <select
                      value={altPick}
                      onChange={(e) => setAltPick(e.target.value as ActionId)}
                      className="rounded-[3px] border border-line-strong bg-bg px-1.5 py-1 text-[12px] text-text"
                    >
                      {ACTION_ORDER.filter((id) => id !== s.ruleV1?.action).map((id) => (
                        <option key={id} value={id}>
                          {ACTIONS[id].label.toLowerCase()}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
          )}
        </Step>
      )}

      {s.answer && s.rule && s.ruleV1 && (
        <Step n="07" title="Rule updated" tone="rule">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="font-mono text-[13px] text-text">
              v{s.ruleV1.version} → <span className="text-rule">v{s.rule.version}</span>
            </div>
            <div className="font-mono text-[13px] text-muted">
              confidence {s.ruleV1.confidence.score.toFixed(2)} →{" "}
              <span className="text-rule">{s.rule.confidence.score.toFixed(2)}</span>
            </div>
          </div>
          <p className="mt-1 text-[12.5px] text-muted">{s.rule.history.at(-1)?.summary}</p>
          <div className="mt-3">
            <Button tone="rule" onClick={onGoTrainee}>
              Test this judgment on a trainee →
            </Button>
          </div>
        </Step>
      )}
    </div>
  );
}

function ChangeAction({ expected, onChoose }: { expected: ActionId; onChoose: (a: ActionId) => void }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-left font-mono text-[10.5px] text-faint underline-offset-2 hover:text-text hover:underline"
      >
        change action (resets what was learned)
      </button>
    );
  }
  return (
    <ActionChooser
      expected={expected}
      onChoose={(a) => {
        setOpen(false);
        onChoose(a);
      }}
    />
  );
}
