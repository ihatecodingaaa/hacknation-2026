import { ACTIONS, ACTION_ORDER } from "@/domain/actions";
import { detectDivergence } from "@/domain/divergence";
import { expectedAction } from "@/domain/playbook";
import { EXPERT_INCIDENT } from "@/domain/scenarios";
import { parseSemanticOutput, type SemanticAttempt } from "@/domain/semantic";
import { deriveSignals } from "@/domain/signals";
import type { ActionId } from "@/domain/types";
import { buildExtractionPrompt } from "@/lib/reasoning/prompt";
import { reasoningProvider } from "@/lib/reasoning/provider";
import { errorMessage } from "@/lib/voice/elevenlabs-server";

const MAX_CHARS = 2_000;
const TIMEOUT_MS = 15_000;

function reply(body: SemanticAttempt & { latencyMs?: number }, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Semantic candidate extraction. Returns schema-validated candidate claims,
 * or a reason it could not. It never returns a rule: the browser verifies the
 * candidates against the transcript and telemetry with deterministic code.
 * Transcripts are not logged or stored.
 */
export async function POST(request: Request) {
  const provider = reasoningProvider();
  if (!provider) {
    return reply({ ok: false, label: "Semantic extractor", reason: "not configured" }, 503);
  }

  let transcript = "";
  let actualAction: ActionId | null = null;
  let incidentId = "";
  try {
    const body = (await request.json()) as { transcript?: unknown; actualAction?: unknown; incidentId?: unknown };
    transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
    actualAction = ACTION_ORDER.includes(body.actualAction as ActionId) ? (body.actualAction as ActionId) : null;
    incidentId = typeof body.incidentId === "string" ? body.incidentId : "";
  } catch {
    // validated below
  }
  if (!transcript || transcript.length > MAX_CHARS || !actualAction || incidentId !== EXPERT_INCIDENT.id) {
    return reply({ ok: false, label: provider.label, reason: `invalid request (transcript 1-${MAX_CHARS} chars, known incident and action)` }, 400);
  }

  const incident = EXPERT_INCIDENT;
  const signals = deriveSignals(incident);
  const expected = expectedAction(signals);
  const divergence = detectDivergence(signals, expected, { action: actualAction, incidentId });
  const message = buildExtractionPrompt({
    transcript,
    incident,
    runbookStep: expected.step,
    expectedAction: expected.action,
    actualAction,
    question: divergence?.question ?? `Why did you choose to ${ACTIONS[actualAction].verb}?`,
  });

  const started = Date.now();
  let raw: string;
  try {
    raw = await provider.complete(message, { timeoutMs: TIMEOUT_MS });
  } catch (err) {
    return reply({ ok: false, label: provider.label, reason: errorMessage(err) }, 502);
  }
  const parsed = parseSemanticOutput(raw);
  if (!parsed.ok) return reply({ ok: false, label: provider.label, reason: parsed.error }, 502);
  return reply({ ok: true, label: provider.label, candidates: parsed.value, latencyMs: Date.now() - started });
}
