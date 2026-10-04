"use client";

import { useState } from "react";
import { ACTIONS, ACTION_ORDER } from "@/domain/actions";
import type { CounterfactualDraft } from "@/domain/session";
import type { ActionId, CounterfactualAnswer, CounterfactualStance } from "@/domain/types";
import { Button, Label, SourceTag, Tag, cx } from "./ui";

/**
 * The counterfactual answer as a draft: what was heard (verbatim), how it was
 * read and from which words. Live and typed answers only change the rule after
 * the expert confirms. A "no" needs an explicit alternative action.
 */
export function CounterfactualReview({
  draft,
  answer,
  ruleAction,
  onConfirm,
  onReopen,
  large = false,
}: {
  draft: CounterfactualDraft;
  answer: CounterfactualAnswer | null;
  ruleAction: ActionId;
  onConfirm: (stance: CounterfactualStance, alternative: ActionId | null) => void;
  onReopen: () => void;
  large?: boolean;
}) {
  const verb = ACTIONS[ruleAction].verb;
  const incomplete = !draft.stance || (draft.stance === "switch" && !draft.alternative);
  const [editing, setEditing] = useState(incomplete);
  const [stance, setStance] = useState<CounterfactualStance | null>(draft.stance);
  const [alternative, setAlternative] = useState<ActionId | null>(draft.alternative);
  const ready = stance === "still" || (stance === "switch" && alternative !== null);
  const text = large ? "text-[14px]" : "text-[12.5px]";

  return (
    <div className="space-y-3">
      <div className="border-l-2 border-line-strong pl-3">
        <Label>SecondShift heard · original transcript</Label>
        <p className={cx("mt-1 italic leading-relaxed text-text", large ? "text-[15px]" : "text-[13px]")}>&ldquo;{draft.text}&rdquo;</p>
        <div className="mt-1">
          <SourceTag source={draft.source} />
        </div>
      </div>

      {answer ? (
        <div className={cx("flex flex-wrap items-center gap-2", text)}>
          <span className="text-muted">Read as:</span>
          {answer.stance === "switch" ? (
            <Tag tone="diverge">no, would not {verb}</Tag>
          ) : (
            <Tag tone="rule">yes, would still {verb}</Tag>
          )}
          {answer.alternative && <Tag tone="expert">instead: {ACTIONS[answer.alternative].label}</Tag>}
          <span className="font-mono text-[11px] text-faint">
            {answer.confirmedBy === "expert" ? "confirmed by the expert" : "scripted demo answer, applied as written"}
          </span>
          <Button
            tone="ghost"
            onClick={() => {
              setStance(answer.stance);
              setAlternative(answer.alternative);
              setEditing(true);
              onReopen();
            }}
          >
            Correct it
          </Button>
        </div>
      ) : (
        <div className="border border-dashed border-unknown/70 bg-unknown/[0.05] px-3 py-3" role="group" aria-label="Interpretation to confirm">
          <Label className="!text-unknown">Draft reading · not applied to the rule yet</Label>
          <dl className={cx("mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1", text)}>
            <dt className="text-faint">Interpreted as</dt>
            <dd className="text-text">
              {draft.stance === "switch" ? `Would not ${verb}` : draft.stance === "still" ? `Would still ${verb}` : "Unclear"}
              {draft.cues.stance && <span className="text-muted"> (from &ldquo;{draft.cues.stance}&rdquo;)</span>}
            </dd>
            {draft.stance !== "still" && (
              <>
                <dt className="text-faint">Instead</dt>
                <dd className="text-text">
                  {draft.alternative ? ACTIONS[draft.alternative].label : "Not named"}
                  {draft.cues.alternative && <span className="text-muted"> (from &ldquo;{draft.cues.alternative}&rdquo;)</span>}
                </dd>
              </>
            )}
          </dl>
          {draft.concerns.length > 0 && (
            <ul className={cx("mt-2 list-inside list-disc text-unknown", large ? "text-[13px]" : "text-[12px]")}>
              {draft.concerns.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}

          {editing && (
            <div className="mt-3 space-y-2 border-t border-line pt-3">
              <div className={cx("text-text", text)}>Expert, what is the answer?</div>
              <div className="flex flex-wrap gap-2">
                <Button tone={stance === "still" ? "rule" : "default"} onClick={() => setStance("still")}>
                  Yes, would still {verb}
                </Button>
                <Button tone={stance === "switch" ? "primary" : "default"} onClick={() => setStance("switch")}>
                  No, would not {verb}
                </Button>
              </div>
              {stance === "switch" && (
                <label className={cx("flex flex-wrap items-center gap-2 text-muted", text)}>
                  What would you do instead?
                  <select
                    value={alternative ?? ""}
                    onChange={(e) => setAlternative((e.target.value || null) as ActionId | null)}
                    className="rounded-[3px] border border-line-strong bg-bg px-1.5 py-1 text-[13px] text-text"
                  >
                    <option value="">Choose an action</option>
                    {ACTION_ORDER.filter((id) => id !== ruleAction).map((id) => (
                      <option key={id} value={id}>
                        {ACTIONS[id].label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button tone="rule" large={large} disabled={!ready} onClick={() => stance && onConfirm(stance, stance === "switch" ? alternative : null)}>
              Confirm interpretation
            </Button>
            {!editing && (
              <Button tone="ghost" large={large} onClick={() => setEditing(true)}>
                Correct it
              </Button>
            )}
          </div>
          <p className="mt-2 text-[11.5px] leading-snug text-faint">
            The rule changes only after the expert confirms. Live transcripts can be misheard; the original words are kept as evidence.
          </p>
        </div>
      )}
    </div>
  );
}
