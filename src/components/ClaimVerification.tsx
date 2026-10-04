import type { ReactNode } from "react";
import { citationVerdict } from "@/domain/extraction";
import { SIGNALS, signalById } from "@/domain/signals";
import { ACTIONS } from "@/domain/actions";
import type { ActionId, Citation, ExpertExplanation, Extraction, IncidentSignal, RejectedCandidate } from "@/domain/types";
import { Label, SourceTag, Tag, cx } from "./ui";

const REJECTED_TEXT: Record<RejectedCandidate["reason"], string> = {
  not_in_transcript: "not in transcript",
  not_observable: "not observable",
  hedged: "expert unsure",
  low_confidence: "low confidence",
  off_topic: "not about the runbook action",
};

function VerdictTag({ c, large }: { c: Citation; large?: boolean }) {
  const v = citationVerdict(c);
  if (v === "supported")
    return (
      <Tag tone="rule" large={large}>
        supported{c.claimed === "absent" ? " (not)" : ""}
      </Tag>
    );
  if (v === "unverifiable")
    return (
      <Tag tone="unknown" dashed large={large}>
        unverifiable
      </Tag>
    );
  return (
    <Tag tone="bad" large={large}>
      contradicted
    </Tag>
  );
}

/** The original transcript, verbatim, with each verified claim marked in place. */
export function HighlightedTranscript({ text, citations, large }: { text: string; citations: Citation[]; large?: boolean }) {
  const parts: ReactNode[] = [];
  let at = 0;
  citations.forEach((c, i) => {
    const start = Math.max(c.start, at);
    if (c.end <= at) return;
    if (start > at) parts.push(text.slice(at, start));
    const v = citationVerdict(c);
    parts.push(
      <mark
        key={i}
        title={`${SIGNALS[c.signal].label}: ${v}`}
        className={cx(
          "rounded-[2px] px-0.5 text-text",
          v === "supported" && "bg-rule/20 underline decoration-rule decoration-2 underline-offset-[4px]",
          v === "contradicted" && "bg-bad/15 line-through decoration-bad",
          v === "unverifiable" && "bg-unknown/10 underline decoration-dashed decoration-unknown underline-offset-[4px]",
        )}
      >
        {text.slice(start, c.end)}
      </mark>,
    );
    at = c.end;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <p className={cx("leading-relaxed text-text", large ? "text-[19px]" : "text-[14px]")}>{parts}</p>;
}

export function ClaimVerification({
  explanation,
  extraction,
  signals,
  incidentId,
  rejected,
  large = false,
}: {
  explanation: ExpertExplanation;
  extraction: Extraction;
  signals: IncidentSignal[];
  incidentId: string;
  /** The runbook action the expert rejected. */
  rejected: ActionId;
  large?: boolean;
}) {
  const x = extraction;
  const td = large ? "py-2 pr-3 text-[14px]" : "py-1.5 pr-2 text-[12px]";
  return (
    <div className="space-y-4">
      <div>
        <Label className="mb-1.5">Original transcript · verbatim</Label>
        <HighlightedTranscript text={explanation.text} citations={x.citations} large={large} />
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <SourceTag source={explanation.source} />
        </div>
        {x.rejectionQuote && (
          <div className={cx("mt-3 text-muted", large ? "text-[15px]" : "text-[12.5px]")}>
            Why not <span className="text-expected">{ACTIONS[rejected].label.toLowerCase()}</span>:{" "}
            <span className="italic text-text">&ldquo;{x.rejectionQuote}&rdquo;</span>
          </div>
        )}
        {x.interpretation && (
          <div className="mt-3 border-l-2 border-line-strong pl-3">
            <Label>Normalized interpretation · written by the extractor, not evidence</Label>
            <p className={cx("mt-1 text-muted", large ? "text-[15px]" : "text-[12.5px]")}>{x.interpretation}</p>
          </div>
        )}
      </div>

      <div>
        <Label className="mb-1.5">Each claim checked against {incidentId} telemetry</Label>
        {x.citations.length === 0 && x.rejected.length === 0 ? (
          <p className="text-[13px] text-muted">No claim about anything observable was found.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-left font-mono text-[10.5px] uppercase tracking-wider text-faint">
                <th className="pb-1 pr-2 font-normal">expert said</th>
                <th className="pb-1 pr-2 font-normal">claim</th>
                <th className="pb-1 pr-2 font-normal">telemetry</th>
                <th className="pb-1 text-right font-normal">result</th>
              </tr>
            </thead>
            <tbody>
              {x.citations.map((c, i) => (
                <tr key={`c${i}`} className="border-t border-line align-top">
                  <td className={cx(td, "italic text-muted")}>&ldquo;{c.quote}&rdquo;</td>
                  <td className={cx(td, "text-text")}>
                    {c.claimed === "absent" ? "Not: " : ""}
                    {SIGNALS[c.signal].label}
                  </td>
                  <td className={cx(td, "font-mono text-muted", large ? "text-[12.5px]" : "text-[11px]")}>
                    {signalById(signals, c.signal)?.detail ?? "not measured"}
                  </td>
                  <td className={cx(td, "pr-0 text-right")}>
                    <VerdictTag c={c} large={large} />
                  </td>
                </tr>
              ))}
              {x.rejected.map((r, i) => (
                <tr key={`r${i}`} className="border-t border-line align-top">
                  <td className={cx(td, "text-faint")}>
                    {r.reason === "not_in_transcript" ? (
                      // The model's wording, not the expert's: never shown as a quote.
                      <span>
                        <span className="font-mono text-[10.5px] uppercase tracking-wider">model wrote:</span> {r.text}
                      </span>
                    ) : (
                      <span className="italic">&ldquo;{r.text}&rdquo;</span>
                    )}
                  </td>
                  <td className={cx(td, "text-muted")}>{r.signal ? SIGNALS[r.signal].label : "(no matching signal)"}</td>
                  <td className={cx(td, "text-faint", large ? "text-[12.5px]" : "text-[11px]")}>{r.detail}</td>
                  <td className={cx(td, "pr-0 text-right")}>
                    <Tag tone="bad" dashed large={large}>
                      rejected: {REJECTED_TEXT[r.reason]}
                    </Tag>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {x.causal.length > 0 && (
        <div>
          <Label className="mb-1">Causal claims</Label>
          <ul className="space-y-1">
            {x.causal.map((c, i) => (
              <li key={i} className={cx("text-muted", large ? "text-[14px]" : "text-[12px]")}>
                <span className="italic">&ldquo;{c.quote}&rdquo;</span> rests on{" "}
                <span className="text-text">{c.cause ? SIGNALS[c.cause].label.toLowerCase() : "something not measured"}</span>:{" "}
                {c.consistent === true ? (
                  <span className="text-rule">telemetry agrees</span>
                ) : c.consistent === false ? (
                  <span className="text-bad">telemetry disagrees</span>
                ) : (
                  <span className="text-unknown">cannot check</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {x.uncertainty.length > 0 && (
        <div>
          <Label className="mb-1">Uncertainty noted by the extractor · model wording, not evidence</Label>
          <ul className="list-inside list-disc text-[12.5px] text-muted">
            {x.uncertainty.map((u, i) => (
              <li key={i}>{u}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="border-t border-line pt-2 font-mono text-[11px] leading-relaxed text-faint">
        Claims proposed by: <span className="text-muted">{x.extractor.label}</span>. Checked by deterministic code: quote in
        transcript, observable signal, telemetry agrees. Only supported claims are learned.
        {x.extractor.fallbackReason && (
          <div className="text-unknown">Semantic extractor not used ({x.extractor.fallbackReason}). Phrase matcher used instead.</div>
        )}
        {x.patternCrossCheck && (
          <div>
            Cross-check, phrase matcher on the same words:{" "}
            {x.patternCrossCheck.length ? x.patternCrossCheck.map((id) => SIGNALS[id].label.toLowerCase()).join("; ") : "nothing"}
          </div>
        )}
      </div>
    </div>
  );
}
