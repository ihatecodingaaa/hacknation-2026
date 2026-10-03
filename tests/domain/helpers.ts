import { EXPERT_INCIDENT, SCRIPTED, TRAINEE_CASES } from "@/domain/scenarios";
import {
  chooseAction,
  resolveStance,
  startSession,
  submitCounterfactualAnswer,
  submitExplanation,
} from "@/domain/session";
import type { ActionId, CounterfactualStance, IncidentState } from "@/domain/types";

export function traineeCase(key: "A" | "B" | "C" | "D"): IncidentState {
  const found = TRAINEE_CASES.find((c) => c.key === key);
  if (!found) throw new Error(`no case ${key}`);
  return found.incident;
}

/** Run the expert half of the demo through the same transitions the UI uses. */
export function learnFromHero(
  opts: {
    action?: ActionId;
    explanation?: string;
    answer?: string;
    stanceOverride?: CounterfactualStance;
  } = {},
) {
  let s = startSession(EXPERT_INCIDENT);
  s = chooseAction(s, opts.action ?? "rollback_deploy");
  if (!s.divergence) throw new Error("expected a divergence");
  const divergence = s.divergence;
  s = submitExplanation(s, opts.explanation ?? SCRIPTED.explanation, "scripted");
  const { ruleV1: v1, counterfactual: cf, extraction } = s;
  if (!v1 || !cf || !extraction) throw new Error("expected a rule and a counterfactual");
  s = submitCounterfactualAnswer(s, opts.answer ?? SCRIPTED.counterfactualAnswer, "scripted");
  if (opts.stanceOverride) s = resolveStance(s, opts.stanceOverride, s.draft?.alternative ?? null);
  const v2 = s.rule;
  if (!s.answer || !v2) throw new Error("unclear stance");
  return {
    session: s,
    incident: s.incident,
    signals: s.signals,
    expected: s.expected,
    divergence,
    extraction,
    v1,
    cf,
    v2,
  };
}
