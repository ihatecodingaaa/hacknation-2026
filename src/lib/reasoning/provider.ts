// Semantic reasoning providers. A provider turns one instruction message into
// raw model text. It never decides anything: parsing, schema validation and
// verification against the transcript and telemetry happen in the caller.
//
// To use a different model (for example a private one hosted in-house),
// implement `complete` and return it from `reasoningProvider()`.

import { API_BASE, UpstreamError, upstreamMessage, withRetry } from "@/lib/voice/elevenlabs-server";

export interface SemanticReasoningProvider {
  id: string;
  /** Shown in the UI next to every claim this provider proposed. */
  label: string;
  complete(message: string, opts: { timeoutMs: number }): Promise<string>;
}

export interface AgentConfig {
  apiKey: string;
  agentId: string;
}

/** Semantic extraction is on when an ElevenLabs agent id is configured, unless explicitly turned off. */
export function reasoningConfig(): AgentConfig | null {
  if (process.env.SECONDSHIFT_SEMANTIC?.trim().toLowerCase() === "off") return null;
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const agentId = process.env.ELEVENLABS_REASONING_AGENT_ID?.trim();
  if (!apiKey || !agentId) return null;
  return { apiKey, agentId };
}

export const AGENT_LABEL = "ElevenLabs Agents (text-only)";

export interface AgentDeps {
  fetch: typeof fetch;
  WebSocket: typeof WebSocket;
}

type Incoming = {
  type?: string;
  ping_event?: { event_id?: number };
  agent_response_event?: { agent_response?: string };
  error_event?: { message?: string; reason?: string };
};

/**
 * One text-only turn with an ElevenLabs agent (ElevenAgents chat mode):
 * get a signed URL with the server key, open the conversation WebSocket,
 * send the instruction as a user message, return the agent's reply.
 * Message shapes follow the official @elevenlabs/client SDK.
 */
export async function runAgentTurn(
  config: AgentConfig,
  message: string,
  timeoutMs: number,
  deps: AgentDeps = { fetch: globalThis.fetch, WebSocket: globalThis.WebSocket },
): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  const signedUrl = await withRetry(async () => {
    const res = await deps.fetch(
      `${API_BASE}/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(config.agentId)}`,
      {
        headers: { "xi-api-key": config.apiKey },
        signal: AbortSignal.timeout(Math.max(1_000, deadline - Date.now())),
        cache: "no-store",
      },
    );
    if (!res.ok) {
      throw new UpstreamError(`ElevenLabs agent session failed (${res.status}): ${await upstreamMessage(res)}`, res.status);
    }
    const json = (await res.json()) as { signed_url?: string };
    if (!json.signed_url) throw new UpstreamError("ElevenLabs returned no signed URL", 502);
    return json.signed_url;
  });

  return new Promise<string>((resolve, reject) => {
    const ws = new deps.WebSocket(signedUrl);
    let sent = false;
    let done = false;
    const finish = (err: Error | null, text?: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close(1000);
      } catch {
        // already closed
      }
      if (err) reject(err);
      else resolve(text ?? "");
    };
    const timer = setTimeout(
      () => finish(Object.assign(new Error("ElevenLabs agent did not answer in time"), { name: "TimeoutError" })),
      Math.max(0, deadline - Date.now()),
    );

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "conversation_initiation_client_data" }));
    });
    ws.addEventListener("message", (event: MessageEvent) => {
      let msg: Incoming;
      try {
        msg = JSON.parse(String(event.data)) as Incoming;
      } catch {
        return;
      }
      if (msg.type === "conversation_initiation_metadata" && !sent) {
        sent = true;
        ws.send(JSON.stringify({ type: "user_message", text: message }));
      } else if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", event_id: msg.ping_event?.event_id }));
      } else if (msg.type === "agent_response" && sent) {
        const text = msg.agent_response_event?.agent_response ?? "";
        // A configured greeting is not the answer; wait for the JSON reply.
        if (text.includes("{")) finish(null, text);
      } else if (msg.type === "error") {
        finish(new Error(`ElevenLabs agent error: ${msg.error_event?.message ?? msg.error_event?.reason ?? "unknown"}`));
      }
    });
    ws.addEventListener("close", (event: CloseEvent) => {
      finish(new Error(`ElevenLabs agent closed the session (${event.code}${event.reason ? `: ${event.reason}` : ""})`));
    });
    ws.addEventListener("error", () => {
      // The close event that follows carries the reason.
    });
  });
}

export function reasoningProvider(): SemanticReasoningProvider | null {
  const config = reasoningConfig();
  if (!config) return null;
  return {
    id: "elevenlabs-agent",
    label: AGENT_LABEL,
    complete: (message, { timeoutMs }) => runAgentTurn(config, message, timeoutMs),
  };
}
