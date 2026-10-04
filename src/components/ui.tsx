import type { ReactNode } from "react";
import type { TranscriptSource } from "@/domain/types";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-faint", className)}>
      {children}
    </div>
  );
}

export function Tag({
  children,
  tone = "muted",
  dashed,
  large,
}: {
  children: ReactNode;
  tone?: "muted" | "expected" | "expert" | "diverge" | "rule" | "bad" | "ok" | "unknown";
  dashed?: boolean;
  large?: boolean;
}) {
  const tones: Record<string, string> = {
    muted: "text-muted border-line-strong",
    expected: "text-expected border-expected/40",
    expert: "text-expert border-expert/50",
    diverge: "text-diverge border-diverge/50",
    rule: "text-rule border-rule/50",
    bad: "text-bad border-bad/50",
    ok: "text-ok border-ok/50",
    unknown: "text-unknown border-unknown/60",
  };
  return (
    <span
      className={cx(
        "inline-flex items-center whitespace-nowrap rounded-[3px] border font-mono uppercase tracking-wider",
        large ? "px-2 py-0.5 text-[12px]" : "px-1.5 py-px text-[10px]",
        dashed && "border-dashed",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

const SOURCE_TEXT: Record<TranscriptSource, string> = {
  elevenlabs_live: "ElevenLabs Scribe v2 Realtime · live",
  elevenlabs_edited: "ElevenLabs Scribe v2 Realtime · edited by expert",
  typed: "Typed by expert",
  scripted: "Scripted demo answer · not live",
};

/** Every piece of captured text says where it came from. */
export function SourceTag({ source }: { source: TranscriptSource | "telemetry" }) {
  if (source === "telemetry") return <Tag>Seeded telemetry</Tag>;
  const live = source === "elevenlabs_live" || source === "elevenlabs_edited";
  return (
    <Tag tone={live ? "expert" : source === "scripted" ? "unknown" : "muted"} dashed={source === "scripted"}>
      {SOURCE_TEXT[source]}
    </Tag>
  );
}

export function Section({
  title,
  aside,
  children,
  className,
}: {
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("border-b border-line px-4 py-3", className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <Label>{title}</Label>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  tone = "default",
  title,
  type = "button",
  large = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "default" | "primary" | "rule" | "danger" | "ghost";
  title?: string;
  type?: "button" | "submit";
  large?: boolean;
}) {
  const tones: Record<string, string> = {
    default: "border-line-strong bg-raised text-text hover:border-muted",
    primary: "border-expert bg-expert/15 text-text hover:bg-expert/25",
    rule: "border-rule bg-rule/15 text-text hover:bg-rule/25",
    danger: "border-bad bg-bad/15 text-text hover:bg-bad/25",
    ghost: "border-transparent bg-transparent text-muted hover:text-text",
  };
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-[3px] border font-medium transition-colors",
        large ? "px-3.5 py-2 text-[15px]" : "px-2.5 py-1 text-[12px]",
        "disabled:cursor-not-allowed disabled:opacity-40",
        tones[tone],
      )}
    >
      {children}
    </button>
  );
}
