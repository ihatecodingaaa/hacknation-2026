"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { evaluateTrainee } from "@/domain/evaluation";
import { EXPERT_INCIDENT, SCRIPTED, TRAINEE_CASES, type TraineeCase } from "@/domain/scenarios";
import {
  chooseAction,
  resolveStance,
  retryExplanation,
  startSession,
  submitCounterfactualAnswer,
  submitExplanation,
  type ExpertSession,
} from "@/domain/session";
import { deriveSignals } from "@/domain/signals";
import type { ActionId, CounterfactualStance, SignalId, TranscriptSource } from "@/domain/types";
import { speak, stopSpeaking } from "@/lib/voice/tts-client";
import { ExpertFlow, type SpeechStatus } from "./ExpertFlow";
import { IncidentPanel, type SignalMark } from "./IncidentPanel";
import { RulePanel } from "./RulePanel";
import { ProvenancePanel, TraineeFlow } from "./TraineeFlow";
import { Button, cx } from "./ui";

type Mode = "expert" | "trainee";
type Speech = { why: SpeechStatus; cf: SpeechStatus };

const SOURCE_SIGNALS = deriveSignals(EXPERT_INCIDENT);

function scriptedSession(): ExpertSession {
  let s = startSession(EXPERT_INCIDENT);
  s = chooseAction(s, "rollback_deploy");
  s = submitExplanation(s, SCRIPTED.explanation, "scripted");
  return submitCounterfactualAnswer(s, SCRIPTED.counterfactualAnswer, "scripted");
}

function expertMarks(s: ExpertSession): Partial<Record<SignalId, SignalMark>> {
  const marks: Partial<Record<SignalId, SignalMark>> = {};
  for (const id of s.divergence?.ignoredSignals ?? []) marks[id] = { tone: "diverge", text: "runbook ignored" };
  if (s.counterfactual) {
    for (const h of s.counterfactual.hypothetical) marks[h.signal] = { tone: "diverge", text: "probed" };
  }
  for (const c of s.rule?.conditions ?? []) {
    for (const id of c.anyOf) marks[id] = { tone: "rule", text: "in rule" };
  }
  return marks;
}

function Pipeline({ stages }: { stages: { label: string; done: boolean }[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-y-1 font-mono text-[10.5px] uppercase tracking-wider">
      {stages.map((st, i) => (
        <li key={st.label} className="flex items-center">
          {i > 0 && <span className={cx("mx-2 h-px w-4", st.done ? "bg-rule" : "bg-line-strong")} />}
          <span className={cx("flex items-center gap-1.5", st.done ? "text-text" : "text-faint")}>
            <span className={cx("h-1.5 w-1.5 rounded-full", st.done ? "bg-rule" : "bg-line-strong")} />
            {st.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function SecondShiftApp({ voiceConfigured }: { voiceConfigured: boolean }) {
  const [mode, setMode] = useState<Mode>("expert");
  const [session, setSession] = useState<ExpertSession>(() => startSession(EXPERT_INCIDENT));
  const [speech, setSpeech] = useState<Speech>({ why: "idle", cf: "idle" });
  const [caseKey, setCaseKey] = useState<TraineeCase["key"]>("A");
  const [traineeChoice, setTraineeChoice] = useState<ActionId | null>(null);
  const [transferred, setTransferred] = useState(false);

  const activeCase = TRAINEE_CASES.find((c) => c.key === caseKey) ?? TRAINEE_CASES[0];
  const traineeSignals = useMemo(() => deriveSignals(activeCase.incident), [activeCase]);
  const rule = session.rule;
  const evaluation = useMemo(
    () => (rule && traineeChoice ? evaluateTrainee(rule, activeCase.incident, traineeChoice) : null),
    [rule, traineeChoice, activeCase],
  );

  function say(which: keyof Speech, text: string) {
    if (!voiceConfigured) {
      setSpeech((p) => ({ ...p, [which]: "unavailable" }));
      return;
    }
    setSpeech((p) => ({ ...p, [which]: "speaking" }));
    void speak(text).then((result) => {
      setSpeech((p) => ({ ...p, [which]: result === "superseded" ? "idle" : result }));
    });
  }

  function onChoose(action: ActionId) {
    const next = chooseAction(session, action);
    setSession(next);
    setSpeech({ why: "idle", cf: "idle" });
    stopSpeaking();
    if (next.divergence) say("why", next.divergence.question);
  }

  function onExplain(text: string, source: TranscriptSource) {
    const next = submitExplanation(session, text, source);
    setSession(next);
    if (next.counterfactual) say("cf", next.counterfactual.question);
  }

  function onAnswer(text: string, source: TranscriptSource) {
    setSession(submitCounterfactualAnswer(session, text, source));
  }

  function onResolveStance(stance: CounterfactualStance, alternative: ActionId | null) {
    setSession(resolveStance(session, stance, alternative));
  }

  function onReplay(which: keyof Speech) {
    const text = which === "why" ? session.divergence?.question : session.counterfactual?.question;
    if (text) say(which, text);
  }

  function onTraineeChoose(action: ActionId) {
    setTraineeChoice(action);
    setTransferred(true);
  }

  function reset() {
    stopSpeaking();
    setMode("expert");
    setSession(startSession(EXPERT_INCIDENT));
    setSpeech({ why: "idle", cf: "idle" });
    setCaseKey("A");
    setTraineeChoice(null);
    setTransferred(false);
  }

  // Bring each newly revealed step into view.
  const focus = !session.chosen
    ? null
    : session.answer
      ? "step-07"
      : session.explanation
        ? "step-05"
        : "step-03";
  const lastFocus = useRef(focus);
  useEffect(() => {
    if (focus === lastFocus.current) return;
    lastFocus.current = focus;
    if (focus) document.getElementById(focus)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focus]);

  const stages = [
    { label: "Expected", done: true },
    { label: "Actual", done: Boolean(session.chosen) },
    { label: "Divergence", done: Boolean(session.divergence) },
    { label: "Why", done: Boolean(session.explanation) },
    { label: "Rule v1", done: Boolean(session.ruleV1) },
    { label: "Counterfactual", done: Boolean(session.answer) },
    { label: "Rule v2", done: (rule?.version ?? 0) >= 2 },
    { label: "Transfer", done: transferred && Boolean(rule) },
  ];

  const traineeMarks: Partial<Record<SignalId, SignalMark>> = {};
  if (evaluation && rule) {
    for (const m of evaluation.match.conditions) {
      for (const id of m.anyOf) {
        const state = traineeSignals.find((s) => s.id === id)?.state;
        if (m.met === true && state !== m.expected) continue;
        traineeMarks[id] =
          m.met === "unknown"
            ? { tone: "unknown", text: "missing" }
            : m.met
              ? { tone: "ok", text: "matches rule" }
              : { tone: "bad", text: "differs" };
      }
    }
    for (const t of evaluation.match.firedGuardrail?.trigger ?? []) {
      traineeMarks[t.signal] = { tone: "bad", text: "guardrail" };
    }
  }

  return (
    <div className="flex min-h-screen flex-col lg:h-screen lg:overflow-hidden">
      <header className="shrink-0 border-b border-line bg-panel">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
          <div className="flex items-baseline gap-3">
            <span className="text-[15px] font-semibold tracking-tight text-text">SecondShift</span>
            <span className="hidden text-[12px] text-muted xl:inline">
              Learns why the expert deviated from the runbook, then teaches it.
            </span>
          </div>

          <nav className="flex rounded-[3px] border border-line-strong p-0.5" aria-label="Mode">
            {(
              [
                ["expert", `1 · Expert shift · ${EXPERT_INCIDENT.id}`],
                ["trainee", "2 · Trainee transfer"],
              ] as const
            ).map(([m, text]) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cx(
                  "rounded-[2px] px-3 py-1 text-[12px] font-medium transition-colors",
                  mode === m ? "bg-raised text-text" : "text-muted hover:text-text",
                )}
                aria-pressed={mode === m}
              >
                {text}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <span
              className={cx(
                "flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-wider",
                voiceConfigured ? "text-expert" : "text-unknown",
              )}
              title={
                voiceConfigured
                  ? "ELEVENLABS_API_KEY is set on the server. Calls can still fail; errors are shown where they happen."
                  : "No ELEVENLABS_API_KEY on the server. Typed and scripted answers only, labelled as such."
              }
            >
              <span className={cx("h-1.5 w-1.5 rounded-full", voiceConfigured ? "bg-expert" : "bg-unknown")} />
              {voiceConfigured ? "Voice: ElevenLabs configured" : "Voice: fallback mode"}
            </span>
            <Button tone="ghost" onClick={reset}>
              Reset demo
            </Button>
          </div>
        </div>
        <div className="border-t border-line px-4 py-1.5">
          <Pipeline stages={stages} />
        </div>
      </header>

      <main className="grid flex-1 grid-cols-1 lg:min-h-0 lg:grid-cols-[272px_minmax(0,1fr)_320px] xl:grid-cols-[300px_minmax(0,1fr)_370px] 2xl:grid-cols-[320px_minmax(0,1fr)_400px]">
        <aside
          key={`incident-${mode === "expert" ? "expert" : caseKey}`}
          className="pane border-b border-line bg-panel lg:overflow-y-auto lg:border-b-0 lg:border-r"
        >
          {mode === "expert" ? (
            <IncidentPanel incident={EXPERT_INCIDENT} signals={session.signals} marks={expertMarks(session)} />
          ) : (
            <IncidentPanel incident={activeCase.incident} signals={traineeSignals} marks={traineeMarks} />
          )}
        </aside>

        <div key={`flow-${mode}`} className="pane @container lg:overflow-y-auto">
          {mode === "expert" ? (
            <ExpertFlow
              session={session}
              voiceConfigured={voiceConfigured}
              speech={speech}
              onChoose={onChoose}
              onExplain={onExplain}
              onRetryExplain={() => setSession(retryExplanation(session))}
              onAnswer={onAnswer}
              onResolveStance={onResolveStance}
              onReplay={onReplay}
              onGoTrainee={() => setMode("trainee")}
            />
          ) : rule ? (
            <TraineeFlow
              rule={rule}
              activeCase={activeCase}
              cases={TRAINEE_CASES}
              onSelectCase={(k) => {
                setCaseKey(k);
                setTraineeChoice(null);
              }}
              choice={traineeChoice}
              onChoose={onTraineeChoose}
              evaluation={evaluation}
              signals={traineeSignals}
              sourceSignals={SOURCE_SIGNALS}
            />
          ) : (
            <div className="max-w-xl px-5 py-6">
              <div className="text-[15px] font-semibold text-text">No learned rule yet</div>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">
                The trainee is graded against judgment learned from the expert. Run the expert shift first: pick the
                expert&apos;s action on {EXPERT_INCIDENT.id}, explain it, answer the counterfactual.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button tone="primary" onClick={() => setMode("expert")}>
                  Go to expert shift
                </Button>
                <Button
                  onClick={() => {
                    setSession(scriptedSession());
                    setSpeech({ why: "idle", cf: "idle" });
                  }}
                >
                  Load scripted expert session
                </Button>
              </div>
              <p className="mt-2 text-[11.5px] text-faint">
                The scripted session uses the seeded answers. Its evidence is tagged &ldquo;scripted · not live&rdquo;.
              </p>
            </div>
          )}
        </div>

        <aside key={`side-${mode}`} className="pane border-t border-line bg-panel lg:overflow-y-auto lg:border-l lg:border-t-0">
          {mode === "expert" || !rule ? (
            <RulePanel rule={rule} />
          ) : (
            <ProvenancePanel rule={rule} evaluation={evaluation} />
          )}
        </aside>
      </main>
    </div>
  );
}
