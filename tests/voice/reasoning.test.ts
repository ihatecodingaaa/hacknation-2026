import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as extract } from "@/app/api/reasoning/extract/route";
import { buildExtractionPrompt } from "@/lib/reasoning/prompt";
import { runAgentTurn } from "@/lib/reasoning/provider";
import { EXPERT_INCIDENT } from "@/domain/scenarios";
import { PLAYBOOK } from "@/domain/playbook";

const KEY = "test-key-never-sent-to-browser";
const VALID = {
  observations: [
    { text: "only the new version is affected", candidateSignal: "new_version_only", polarity: "present", confidence: 0.9 },
  ],
  causalClaims: [],
  rejectedAlternative: null,
  decisionRationale: "Only the new version fails.",
  uncertainty: [],
};

/** Stands in for the ElevenAgents conversation socket. Records what the client sends. */
function fakeAgentSocket(reply: (sent: unknown[]) => unknown[]) {
  const sent: unknown[] = [];
  class FakeSocket extends EventTarget {
    static instances: FakeSocket[] = [];
    url: string;
    constructor(url: string) {
      super();
      this.url = url;
      FakeSocket.instances.push(this);
      setTimeout(() => this.dispatchEvent(new Event("open")), 0);
    }
    send(data: string) {
      const msg = JSON.parse(data);
      sent.push(msg);
      if (msg.type === "conversation_initiation_client_data") {
        this.emit({ type: "conversation_initiation_metadata", conversation_initiation_metadata_event: { conversation_id: "c1" } });
      }
      if (msg.type === "user_message") for (const m of reply(sent)) this.emit(m);
    }
    emit(m: unknown) {
      setTimeout(() => this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(m) })), 0);
    }
    close() {}
  }
  return { FakeSocket, sent };
}

function signedUrlFetch() {
  return vi.fn(async () => Response.json({ signed_url: "wss://example.test/convai?token=abc" }));
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("ElevenLabs agent turn", () => {
  it("follows the chat-mode protocol: init, user message, pong, agent response", async () => {
    const { FakeSocket, sent } = fakeAgentSocket(() => [
      { type: "ping", ping_event: { event_id: 7 } },
      { type: "agent_response", agent_response_event: { agent_response: "Hello! How can I help?" } },
      { type: "agent_response", agent_response_event: { agent_response: JSON.stringify(VALID) } },
    ]);
    const fetchMock = signedUrlFetch();
    const text = await runAgentTurn({ apiKey: KEY, agentId: "agent_1" }, "extract this", 2_000, {
      fetch: fetchMock as unknown as typeof fetch,
      WebSocket: FakeSocket as unknown as typeof WebSocket,
    });
    expect(JSON.parse(text)).toEqual(VALID);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=agent_1");
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe(KEY);
    expect(FakeSocket.instances[0].url).toBe("wss://example.test/convai?token=abc");
    expect(sent).toEqual([
      { type: "conversation_initiation_client_data" },
      { type: "user_message", text: "extract this" },
      { type: "pong", event_id: 7 },
    ]);
  });

  it("does not retry an auth failure", async () => {
    const fetchMock = vi.fn(async () => Response.json({ detail: { message: "Invalid API key" } }, { status: 401 }));
    const { FakeSocket } = fakeAgentSocket(() => []);
    await expect(
      runAgentTurn({ apiKey: KEY, agentId: "a" }, "x", 2_000, {
        fetch: fetchMock as unknown as typeof fetch,
        WebSocket: FakeSocket as unknown as typeof WebSocket,
      }),
    ).rejects.toThrow("ElevenLabs agent session failed (401): Invalid API key");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("times out instead of hanging when the agent never answers", async () => {
    const { FakeSocket } = fakeAgentSocket(() => []);
    await expect(
      runAgentTurn({ apiKey: KEY, agentId: "a" }, "x", 50, {
        fetch: signedUrlFetch() as unknown as typeof fetch,
        WebSocket: FakeSocket as unknown as typeof WebSocket,
      }),
    ).rejects.toThrow("did not answer in time");
  });
});

describe("extraction prompt", () => {
  it("sends the transcript and context but not the telemetry-derived signal states", () => {
    const prompt = buildExtractionPrompt({
      transcript: "only the new version is affected",
      incident: EXPERT_INCIDENT,
      runbookStep: PLAYBOOK[2],
      expectedAction: "restart_service",
      actualAction: "rollback_deploy",
      question: "Why?",
    });
    expect(prompt).toContain('"""\nonly the new version is affected\n"""');
    expect(prompt).toContain("new_version_only");
    expect(prompt).not.toContain("19.3");
    expect(prompt).not.toMatch(/"present"\s*:\s*true/);
    expect(prompt).not.toContain("9.8%");
  });
});

describe("/api/reasoning/extract", () => {
  function req(body: unknown) {
    return new Request("http://localhost/api/reasoning/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  const good = { transcript: "only the new version is affected", actualAction: "rollback_deploy", incidentId: "INC-2041" };

  it("reports not configured without an agent id, so the UI uses the phrase matcher", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", KEY);
    vi.stubEnv("ELEVENLABS_REASONING_AGENT_ID", "");
    const res = await extract(req(good));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, reason: "not configured" });
  });

  it("can be switched off explicitly", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", KEY);
    vi.stubEnv("ELEVENLABS_REASONING_AGENT_ID", "agent_1");
    vi.stubEnv("SECONDSHIFT_SEMANTIC", "off");
    expect((await extract(req(good))).status).toBe(503);
  });

  it("returns validated candidates and never echoes the key", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", KEY);
    vi.stubEnv("ELEVENLABS_REASONING_AGENT_ID", "agent_1");
    const { FakeSocket } = fakeAgentSocket(() => [
      { type: "agent_response", agent_response_event: { agent_response: "```json\n" + JSON.stringify(VALID) + "\n```" } },
    ]);
    vi.stubGlobal("fetch", signedUrlFetch());
    vi.stubGlobal("WebSocket", FakeSocket);
    const res = await extract(req(good));
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(KEY);
    expect(JSON.parse(text)).toMatchObject({ ok: true, label: "ElevenLabs Agents (text-only)", candidates: VALID });
  });

  it("rejects malformed model output instead of passing it on", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", KEY);
    vi.stubEnv("ELEVENLABS_REASONING_AGENT_ID", "agent_1");
    const { FakeSocket } = fakeAgentSocket(() => [
      { type: "agent_response", agent_response_event: { agent_response: '{"observations": "the deploy"}' } },
    ]);
    vi.stubGlobal("fetch", signedUrlFetch());
    vi.stubGlobal("WebSocket", FakeSocket);
    const res = await extract(req(good));
    expect(res.status).toBe(502);
    expect((await res.json()).reason).toMatch(/schema validation/);
  });

  it("validates the request", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", KEY);
    vi.stubEnv("ELEVENLABS_REASONING_AGENT_ID", "agent_1");
    vi.stubGlobal("fetch", vi.fn());
    expect((await extract(req({ ...good, transcript: "" }))).status).toBe(400);
    expect((await extract(req({ ...good, actualAction: "delete_prod" }))).status).toBe(400);
    expect((await extract(req({ ...good, incidentId: "INC-9999" }))).status).toBe(400);
  });
});
