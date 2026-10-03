import { ACTIONS } from "./actions";
import { SIGNALS } from "./signals";
import type {
  DecisionDivergence,
  ExpectedAction,
  ExpertAction,
  IncidentSignal,
} from "./types";

/**
 * Compare what the playbook expects with what the expert did.
 * Returns null when they agree: there is nothing new to learn, so we stay quiet.
 */
export function detectDivergence(
  signals: IncidentSignal[],
  expected: ExpectedAction,
  actual: ExpertAction,
): DecisionDivergence | null {
  if (expected.action === actual.action) return null;

  const ignoredSignals = signals
    .filter((s) => s.state === "present" && !expected.usedSignals.includes(s.id))
    .map((s) => s.id);

  const exp = ACTIONS[expected.action];
  const act = ACTIONS[actual.action];
  const ignored = ignoredSignals.map((id) => SIGNALS[id].label.toLowerCase());

  const reason =
    ignored.length > 0
      ? `Runbook step ${expected.step.id} (${expected.step.when}) says ${exp.label.toLowerCase()}. ` +
        `The expert chose ${act.label.toLowerCase()}. The runbook did not look at: ${ignored.join("; ")}. ` +
        `The reason is probably in there, and it only exists in the expert's head.`
      : `Runbook step ${expected.step.id} (${expected.step.when}) says ${exp.label.toLowerCase()}. ` +
        `The expert chose ${act.label.toLowerCase()}, and no signal on screen explains why. ` +
        `The reason is not in the telemetry at all.`;

  return {
    expected,
    actual,
    ignoredSignals,
    reason,
    question: `You ${act.past} instead of ${exp.gerund}. What made you choose that?`,
  };
}
