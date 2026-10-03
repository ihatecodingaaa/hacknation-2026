import { detectDivergence } from "@/domain/divergence";
import { applyCounterfactual, generateCounterfactual, interpretAnswer } from "@/domain/counterfactual";
import { extractExplanation } from "@/domain/extraction";
import { expectedAction } from "@/domain/playbook";
import { buildRule } from "@/domain/rules";
import { EXPERT_INCIDENT, SCRIPTED, TRAINEE_CASES } from "@/domain/scenarios";
import { deriveSignals } from "@/domain/signals";
import type { ActionId, CounterfactualStance, IncidentState } from "@/domain/types";

export function traineeCase(key: "A" | "B" | "C" | "D"): IncidentState {
  const found = TRAINEE_CASES.find((c) => c.key === key);
  if (!found) throw new Error(`no case ${key}`);
  return found.incident;
}

/** Run the expert half of the demo the same way the UI does. */
export function learnFromHero(opts: {
  action?: ActionId;
  explanation?: string;
  answer?: string;
  stanceOverride?: CounterfactualStance;
} = {}) {
  const incident = EXPERT_INCIDENT;
  const signals = deriveSignals(incident);
  const expected = expectedAction(signals);
  const divergence = detectDivergence(signals, expected, {
    action: opts.action ?? "rollback_deploy",
    incidentId: incident.id,
  });
  if (!divergence) throw new Error("expected a divergence");
  const explanation = { text: opts.explanation ?? SCRIPTED.explanation, source: "scripted" as const };
  const extraction = extractExplanation(explanation.text, signals, expected.action);
  const v1 = buildRule({ incident, signals, divergence, explanation, extraction });
  if (!v1) throw new Error("expected a rule");
  const cf = generateCounterfactual(v1, signals);
  if (!cf) throw new Error("expected a counterfactual");
  const parsed = interpretAnswer(opts.answer ?? SCRIPTED.counterfactualAnswer, "scripted", v1.action);
  const stance = opts.stanceOverride ?? parsed.stance;
  if (!stance) throw new Error("unclear stance");
  const v2 = applyCounterfactual(v1, cf, { ...parsed, stance });
  return { incident, signals, expected, divergence, extraction, v1, cf, v2 };
}
