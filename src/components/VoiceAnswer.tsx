"use client";

import { useEffect, useRef, useState } from "react";
import type { TranscriptSource } from "@/domain/types";
import { ScribeSession } from "@/lib/voice/scribe-client";
import { Button, SourceTag, cx } from "./ui";

type RecState = "idle" | "connecting" | "recording" | "finishing";

export interface ScriptedOption {
  label: string;
  text: string;
}

/**
 * Captures one answer from the expert: live via ElevenLabs Scribe, typed, or
 * a scripted fallback. The source always travels with the text.
 */
export function VoiceAnswer({
  voiceConfigured,
  scripted,
  submitLabel,
  onSubmit,
  placeholder,
}: {
  voiceConfigured: boolean;
  scripted: ScriptedOption[];
  submitLabel: string;
  onSubmit: (text: string, source: TranscriptSource) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const [partial, setPartial] = useState("");
  const [source, setSource] = useState<TranscriptSource>("typed");
  const [rec, setRec] = useState<RecState>("idle");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const holder = useRef<{ session: ScribeSession | null; lastLevel: number }>({ session: null, lastLevel: 0 });

  useEffect(() => {
    const h = holder.current;
    return () => h.session?.cancel();
  }, []);

  async function start() {
    setError(null);
    setText("");
    setPartial("");
    setRec("connecting");
    try {
      const session = await ScribeSession.start({
        onTranscript: (full, live) => {
          setText(full);
          setPartial(live);
          setSource("elevenlabs_live");
        },
        onLevel: (rms) => {
          const now = performance.now();
          if (now - holder.current.lastLevel > 80) {
            holder.current.lastLevel = now;
            setLevel(rms);
          }
        },
        onError: (message) => {
          holder.current.session?.cancel();
          holder.current.session = null;
          setRec("idle");
          setLevel(0);
          setError(message);
        },
      });
      holder.current.session = session;
      setRec("recording");
    } catch (err) {
      setRec("idle");
      setError(err instanceof Error ? err.message : "Could not start live transcription");
    }
  }

  async function stop() {
    const session = holder.current.session;
    if (!session) return;
    setRec("finishing");
    const final = await session.stop();
    holder.current.session = null;
    setRec("idle");
    setLevel(0);
    setPartial("");
    setText(final);
    if (!final) setError("ElevenLabs returned no speech. Try again, or type the answer.");
  }

  function edit(value: string) {
    setText(value);
    if (source === "elevenlabs_live") setSource("elevenlabs_edited");
    if (source === "scripted") setSource("typed");
  }

  const busy = rec !== "idle";
  const canSubmit = !busy && text.trim().length > 0;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {rec === "recording" || rec === "finishing" ? (
          <Button tone="danger" onClick={stop} disabled={rec === "finishing"}>
            <span className="rec-dot inline-block h-2 w-2 rounded-full bg-bad" />
            {rec === "finishing" ? "Finalising transcript…" : "Stop recording"}
          </Button>
        ) : (
          <Button
            tone="primary"
            onClick={start}
            disabled={!voiceConfigured || rec === "connecting"}
            title={voiceConfigured ? "Speak your answer" : "ELEVENLABS_API_KEY is not set on the server"}
          >
            <span className="inline-block h-2 w-2 rounded-full bg-expert" />
            {rec === "connecting" ? "Connecting to ElevenLabs…" : "Answer by voice"}
          </Button>
        )}
        {rec === "recording" && (
          <div className="flex h-3 w-24 items-center overflow-hidden rounded-[2px] bg-line" aria-hidden>
            <div className="h-full bg-expert transition-[width] duration-75" style={{ width: `${Math.min(100, level * 600)}%` }} />
          </div>
        )}
        <span className="text-faint">or</span>
        {scripted.map((s) => (
          <Button
            key={s.label}
            tone="ghost"
            disabled={busy}
            onClick={() => {
              setError(null);
              setText(s.text);
              setSource("scripted");
            }}
          >
            {s.label}
          </Button>
        ))}
      </div>

      {!voiceConfigured && (
        <p className="text-[11.5px] text-faint">
          Live voice is off: <span className="font-mono">ELEVENLABS_API_KEY</span> is not set on the server. Type the
          answer or use the scripted one. Scripted text is labelled as such.
        </p>
      )}

      {error && (
        <div className="rounded-[3px] border border-bad/50 bg-bad/5 px-2 py-1.5 text-[12px] text-bad">
          {error}. Type the answer or use the scripted one instead.
        </div>
      )}

      <div className="relative">
        <textarea
          value={text}
          onChange={(e) => edit(e.target.value)}
          readOnly={busy}
          rows={3}
          placeholder={placeholder ?? "Type the answer…"}
          className={cx(
            "w-full resize-y rounded-[3px] border bg-bg px-2.5 py-2 text-[13px] leading-relaxed text-text outline-none",
            "placeholder:text-faint focus:border-muted",
            busy ? "border-expert/60" : "border-line-strong",
          )}
        />
        {busy && partial && (
          <div className="pointer-events-none absolute bottom-2 right-2 font-mono text-[10px] text-expert">live…</div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <div>{text.trim() && <SourceTag source={source} />}</div>
        <Button tone="primary" disabled={!canSubmit} onClick={() => onSubmit(text.trim(), source)}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
