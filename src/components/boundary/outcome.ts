import { ACTIONS } from "@/domain/actions";
import type { BoundaryOutcome } from "@/domain/boundary";
import type { ActionId } from "@/domain/types";

export type OutcomeTone = "rule" | "bad" | "muted" | "unknown";

export interface OutcomeText {
  title: string;
  detail: string;
  tone: OutcomeTone;
}

/** Words for a boundary outcome. `runbook` is what the runbook does in that situation. */
export function describeOutcome(o: BoundaryOutcome, runbook: ActionId): OutcomeText {
  switch (o.kind) {
    case "apply":
      return { title: ACTIONS[o.action].label, detail: "Learned rule applies", tone: "rule" };
    case "instead":
      return {
        title: ACTIONS[o.action].label,
        detail: o.origin === "counterfactual" ? `Expert's counterfactual answer · v${o.introducedIn}` : `Guardrail · v${o.introducedIn}`,
        tone: "rule",
      };
    case "stand_down":
      return {
        title: "Rule stands down",
        detail: `Guardrail · v${o.introducedIn} · runbook: ${ACTIONS[runbook].label.toLowerCase()}`,
        tone: "bad",
      };
    case "silent":
      return { title: "Rule is silent", detail: `Runbook: ${ACTIONS[runbook].label.toLowerCase()}`, tone: "muted" };
    case "abstain":
      return { title: "Abstain", detail: "Evidence missing: verify before acting", tone: "unknown" };
  }
}

export const TONE_BOX: Record<OutcomeTone, string> = {
  rule: "border-rule/70 bg-rule/[0.09]",
  bad: "border-bad/60 bg-bad/[0.07]",
  muted: "border-line-strong bg-raised",
  unknown: "border-dashed border-unknown/70 bg-unknown/[0.06]",
};

export const TONE_TEXT: Record<OutcomeTone, string> = {
  rule: "text-rule",
  bad: "text-bad",
  muted: "text-expected",
  unknown: "text-unknown",
};
