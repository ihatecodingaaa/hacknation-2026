"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { deriveBoundaryMap, placeIncident } from "@/domain/boundary";
import { evaluateTrainee } from "@/domain/evaluation";
import { EXPERT_INCIDENT, SCRIPTED, TRAINEE_CASES, type TraineeCase } from "@/domain/scenarios";
import type { SemanticAttempt } from "@/domain/semantic";
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
import { DecisionBoundaryMap } from "./boundary/DecisionBoundaryMap";
import { BenchmarkPanel, MemoryPanel, useBenchmark, useDecisionMemory } from "./Evaluation";
import { ExpertFlow, type SpeechStatus } from "./ExpertFlow";
import { IncidentPanel, type SignalMark } from "./IncidentPanel";
import { JudgeView, type Chapter } from "./judge/JudgeView";
import { RulePanel } from "./RulePanel";
import { ProvenancePanel, TraineeFlow } from "./TraineeFlow";
import { Button, Label, cx } from "./ui";

type View = "judge" | "analyst";
type Mode = "expert" | "trainee" | "evaluate";
type Speech = { why: SpeechStatus; cf: SpeechStatus };

export interface ReasoningStatus {
  configured: boolean;
  label: string;
}

const SOURCE_SIGNALS = deriveSignals(EXPERT_INCIDENT);
const EXTRACT_TIMEOUT_MS = 20_000;

function scriptedSession(): ExpertSession {
  let s = startSession(EXPERT_INCIDENT);
  s = chooseAction(s, "rollback_deploy");
  s = submitExplanation(s, SCRIPTED.explanation, "scripted");
  return submitCounterfactualAnswer(s, SCRIPTED.counterfactualAnswer, "scripted");
}

/** Ask the server's semantic extractor for candidate claims. Never throws. */
async function requestCandidates(text: string, s: ExpertSession, label: string): Promise<SemanticAttempt> {
  try {
    const res = await fetch("/api/reasoning/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: text, incidentId: s.incident.id, actualAction: s.chosen }),
      signal: AbortSignal.timeout(EXTRACT_TIMEOUT_MS),
    });
    const json = (await res.json().catch(() => null)) as SemanticAttempt | null;
    if (json && typeof json.ok === "boolean") return json;
    return { ok: false, label, reason: `unexpected response (${res.status})` };
  } catch (err) {
    return { ok: false, label, reason: err instanceof Error && err.name === "TimeoutError" ? "timed out" : "request failed" };
  }
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

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
}) {
  return (
    <nav className="flex rounded-[3px] border border-line-strong p-0.5" aria-label={label}>
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cx(
            "rounded-[2px] px-3 py-1 text-[12.5px] font-medium transition-colors",
            value === v ? "bg-raised text-text" : "text-muted hover:text-text",
          )}
          aria-pressed={value === v}
        >
          {text}
        </button>
      ))}
    </nav>
  );
}

export function SecondShiftApp({
  voiceConfigured,
  reasoning,
  initialView = "judge",
}: {
  voiceConfigured: boolean;
  reasoning: ReasoningStatus;
  initialView?: View;
}) {
  const [view, setView] = useState<View>(initialView);
  const [chapter, setChapter] = useState<Chapter>("before");
  const [mode, setMode] = useState<Mode>("expert");
  const [session, setSession] = useState<ExpertSession>(() => startSession(EXPERT_INCIDENT));
  const [speech, setSpeech] = useState<Speech>({ why: "idle", cf: "idle" });
  const [extracting, setExtracting] = useState<string | null>(null);
  const [caseKey, setCaseKey] = useState<TraineeCase["key"]>("A");
  const [traineeChoice, setTraineeChoice] = useState<ActionId | null>(null);
  const [transferred, setTransferred] = useState(false);

  // Async extraction must apply to the session it started from, not a reset one.
  const sessionRef = useRef(session);
  const viewRef = useRef(view);
  const requestId = useRef(0);
  useEffect(() => {
    sessionRef.current = session;
    viewRef.current = view;
  }, [session, view]);

  const activeCase = TRAINEE_CASES.find((c) => c.key === caseKey) ?? TRAINEE_CASES[0];
  const traineeSignals = useMemo(() => deriveSignals(activeCase.incident), [activeCase]);
  const rule = session.rule;
  const evaluation = useMemo(
    () => (rule && traineeChoice ? evaluateTrainee(rule, activeCase.incident, traineeChoice) : null),
    [rule, traineeChoice, activeCase],
  );
  const map = useMemo(
    () => (rule ? deriveBoundaryMap(rule, session.signals, rule.version > 1 ? session.ruleV1 : null) : null),
    [rule, session.signals, session.ruleV1],
  );
  const placement = useMemo(() => (rule && traineeChoice ? placeIncident(rule, traineeSignals) : null), [rule, traineeSignals, traineeChoice]);
  const benchmark = useBenchmark(session.ruleV1, rule);
  const memory = useDecisionMemory(rule);

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

  function cancelPending() {
    requestId.current++;
    setExtracting(null);
  }

  function onChoose(action: ActionId) {
    cancelPending();
    const next = chooseAction(session, action);
    setSession(next);
    setSpeech({ why: "idle", cf: "idle" });
    stopSpeaking();
    if (!next.divergence) return;
    if (view === "analyst") say("why", next.divergence.question);
    else setChapter("surprise");
  }

  function onAskWhy() {
    setChapter("why");
    if (session.divergence && !session.explanation) say("why", session.divergence.question);
  }

  async function onExplain(text: string, source: TranscriptSource) {
    const id = ++requestId.current;
    const started = sessionRef.current;
    let attempt: SemanticAttempt | null = null;
    if (reasoning.configured) {
      setExtracting(`Extracting claims · ${reasoning.label}…`);
      attempt = await requestCandidates(text, started, reasoning.label);
      if (id !== requestId.current) return;
      setExtracting(null);
    }
    const current = sessionRef.current;
    if (current.chosen !== started.chosen || current.explanation) return;
    const next = submitExplanation(current, text, source, attempt);
    setSession(next);
    // The view may have changed while the extractor was working.
    if (viewRef.current === "analyst" && next.counterfactual) say("cf", next.counterfactual.question);
  }

  function onProbe() {
    setChapter("boundary");
    if (session.counterfactual && !session.answer) say("cf", session.counterfactual.question);
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

  function onSelectCase(k: TraineeCase["key"]) {
    setCaseKey(k);
    setTraineeChoice(null);
  }

  function loadScripted() {
    cancelPending();
    setSession(scriptedSession());
    setSpeech({ why: "idle", cf: "idle" });
  }

  function reset() {
    stopSpeaking();
    cancelPending();
    setMode("expert");
    setChapter("before");
    setSession(startSession(EXPERT_INCIDENT));
    setSpeech({ why: "idle", cf: "idle" });
    setCaseKey("A");
    setTraineeChoice(null);
    setTransferred(false);
  }

  // Analyst view: bring each newly revealed step into view.
  const focus = !session.chosen ? null : session.answer ? "step-07" : session.explanation ? "step-05" : "step-03";
  const lastFocus = useRef(focus);
  useEffect(() => {
    if (focus === lastFocus.current) return;
    lastFocus.current = focus;
    if (focus && view === "analyst") document.getElementById(focus)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focus, view]);

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
          m.met === "unknown" ? { tone: "unknown", text: "missing" } : m.met ? { tone: "ok", text: "matches rule" } : { tone: "bad", text: "differs" };
      }
    }
    for (const t of evaluation.match.firedGuardrail?.trigger ?? []) {
      traineeMarks[t.signal] = { tone: "bad", text: "guardrail" };
    }
  }

  return (
    <div className="flex min-h-screen flex-col lg:h-screen lg:overflow-hidden">
      <header className="shrink-0 border-b border-line bg-panel">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5">
          <div className="flex items-baseline gap-3">
            <span className="text-[16px] font-semibold tracking-tight text-text">SecondShift</span>
            <span className="hidden text-[13px] text-muted xl:inline">Learns what changes the expert&apos;s mind.</span>
          </div>

          <Segmented
            label="View"
            value={view}
            onChange={setView}
            options={[
              ["judge", "Story view"],
              ["analyst", "Analyst view"],
            ]}
          />

          {view === "analyst" && (
            <Segmented
              label="Mode"
              value={mode}
              onChange={setMode}
              options={[
                ["expert", `1 · Expert shift · ${EXPERT_INCIDENT.id}`],
                ["trainee", "2 · Trainee transfer"],
                ["evaluate", "3 · Evaluate & memory"],
              ]}
            />
          )}

          <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1">
            <span
              className={cx("flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider", voiceConfigured ? "text-expert" : "text-unknown")}
              title={
                voiceConfigured
                  ? "ELEVENLABS_API_KEY is set on the server. Calls can still fail; errors are shown where they happen."
                  : "No ELEVENLABS_API_KEY on the server. Typed and scripted answers only, labelled as such."
              }
            >
              <span className={cx("h-1.5 w-1.5 rounded-full", voiceConfigured ? "bg-expert" : "bg-unknown")} />
              {voiceConfigured ? "Voice: ElevenLabs" : "Voice: fallback"}
            </span>
            <span
              className={cx("flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider", reasoning.configured ? "text-expert" : "text-muted")}
              title={
                reasoning.configured
                  ? "Candidate claims come from an ElevenLabs agent; deterministic code verifies every one."
                  : "No ELEVENLABS_REASONING_AGENT_ID: claims come from the deterministic phrase matcher."
              }
            >
              <span className={cx("h-1.5 w-1.5 rounded-full", reasoning.configured ? "bg-expert" : "bg-line-strong")} />
              {reasoning.configured ? "Claims: ElevenLabs agent" : "Claims: phrase matcher"}
            </span>
            <Button tone="ghost" onClick={reset}>
              Reset demo
            </Button>
          </div>
        </div>
        {view === "analyst" && (
          <div className="border-t border-line px-4 py-1.5">
            <Pipeline stages={stages} />
          </div>
        )}
      </header>

      {view === "judge" ? (
        <JudgeView
          chapter={chapter}
          onChapter={setChapter}
          session={session}
          voiceConfigured={voiceConfigured}
          speech={speech}
          onReplay={onReplay}
          extracting={extracting}
          onChoose={onChoose}
          onAskWhy={onAskWhy}
          onExplain={onExplain}
          onRetryExplain={() => setSession(retryExplanation(session))}
          onProbe={onProbe}
          onAnswer={onAnswer}
          onResolveStance={onResolveStance}
          onLoadScripted={loadScripted}
          map={map}
          cases={TRAINEE_CASES}
          activeCase={activeCase}
          onSelectCase={onSelectCase}
          traineeSignals={traineeSignals}
          traineeChoice={traineeChoice}
          onTraineeChoose={onTraineeChoose}
          evaluation={evaluation}
          placement={placement}
          benchmark={benchmark}
          memory={memory}
        />
      ) : (
        <main className="grid flex-1 grid-cols-1 lg:min-h-0 lg:grid-cols-[272px_minmax(0,1fr)_320px] xl:grid-cols-[300px_minmax(0,1fr)_370px] 2xl:grid-cols-[320px_minmax(0,1fr)_400px]">
          <aside
            key={`incident-${mode === "trainee" ? caseKey : "expert"}`}
            className="pane border-b border-line bg-panel lg:overflow-y-auto lg:border-b-0 lg:border-r"
          >
            {mode === "trainee" ? (
              <IncidentPanel incident={activeCase.incident} signals={traineeSignals} marks={traineeMarks} />
            ) : (
              <IncidentPanel incident={EXPERT_INCIDENT} signals={session.signals} marks={expertMarks(session)} />
            )}
          </aside>

          <div key={`flow-${mode}`} className="pane @container lg:overflow-y-auto">
            {mode === "expert" ? (
              <ExpertFlow
                session={session}
                voiceConfigured={voiceConfigured}
                speech={speech}
                extracting={extracting}
                map={map}
                onChoose={onChoose}
                onExplain={onExplain}
                onRetryExplain={() => setSession(retryExplanation(session))}
                onAnswer={onAnswer}
                onResolveStance={onResolveStance}
                onReplay={onReplay}
                onGoTrainee={() => setMode("trainee")}
              />
            ) : !rule ? (
              <div className="max-w-xl px-5 py-6">
                <div className="text-[15px] font-semibold text-text">No learned rule yet</div>
                <p className="mt-2 text-[13px] leading-relaxed text-muted">
                  The trainee is graded against judgment learned from the expert. Run the expert shift first: pick the expert&apos;s
                  action on {EXPERT_INCIDENT.id}, explain it, answer the counterfactual.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button tone="primary" onClick={() => setMode("expert")}>
                    Go to expert shift
                  </Button>
                  <Button onClick={loadScripted}>Load scripted expert session</Button>
                </div>
                <p className="mt-2 text-[11.5px] text-faint">
                  The scripted session uses the seeded answers. Its evidence is tagged &ldquo;scripted · not live&rdquo;.
                </p>
              </div>
            ) : mode === "trainee" ? (
              <TraineeFlow
                rule={rule}
                activeCase={activeCase}
                cases={TRAINEE_CASES}
                onSelectCase={onSelectCase}
                choice={traineeChoice}
                onChoose={onTraineeChoose}
                evaluation={evaluation}
                signals={traineeSignals}
                sourceSignals={SOURCE_SIGNALS}
                map={map}
                placement={placement}
              />
            ) : (
              <div className="space-y-8 px-5 py-4">
                <section>
                  <Label className="mb-2">Seeded benchmark · runbook vs runbook + decision memory</Label>
                  {benchmark && <BenchmarkPanel results={benchmark} showTable />}
                </section>
                <section>
                  <Label className="mb-2">Agent-ready decision memory</Label>
                  {memory && <MemoryPanel json={memory.json} memory={memory.memory} />}
                </section>
                {map && (
                  <section>
                    <Label className="mb-2">Decision boundary map</Label>
                    <DecisionBoundaryMap map={map} rule={rule} size="compact" />
                  </section>
                )}
              </div>
            )}
          </div>

          <aside key={`side-${mode}`} className="pane border-t border-line bg-panel lg:overflow-y-auto lg:border-l lg:border-t-0">
            {mode === "trainee" && rule ? <ProvenancePanel rule={rule} evaluation={evaluation} /> : <RulePanel rule={rule} />}
          </aside>
        </main>
      )}
    </div>
  );
}
