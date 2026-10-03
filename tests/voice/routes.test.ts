import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as scribeToken } from "@/app/api/voice/scribe-token/route";
import { POST as speakRoute } from "@/app/api/voice/speak/route";
import { GET as status } from "@/app/api/voice/status/route";

const KEY = "test-key-never-sent-to-browser";

function speakRequest(body: unknown) {
  return new Request("http://localhost/api/voice/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("without ELEVENLABS_API_KEY (fallback mode)", () => {
  it("reports voice as not configured", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    expect(await (await status()).json()).toMatchObject({ configured: false });
  });

  it("refuses to mint a token and says why", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    const res = await scribeToken();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("ELEVENLABS_API_KEY");
  });

  it("does not attempt TTS", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await speakRoute(speakRequest({ text: "hi" }))).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("with ELEVENLABS_API_KEY", () => {
  it("mints a single-use realtime_scribe token server-side", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", KEY);
    const fetchMock = vi.fn(async () => Response.json({ token: "sutkn_abc" }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await scribeToken();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ token: "sutkn_abc" });
    expect(JSON.stringify(body)).not.toContain(KEY);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.elevenlabs.io/v1/single-use-token/realtime_scribe");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe(KEY);
  });

  it("surfaces upstream auth failures as 502 with the reason", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", KEY);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ detail: { message: "Invalid API key" } }, { status: 401 })),
    );
    const res = await scribeToken();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("ElevenLabs token request failed (401): Invalid API key");
  });

  it("reports a timeout cleanly", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", KEY);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("timed out", "TimeoutError");
      }),
    );
    const res = await speakRoute(speakRequest({ text: "Why did you roll back?" }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("ElevenLabs did not respond in time");
  });

  it("returns audio from TTS", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", KEY);
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await speakRoute(speakRequest({ text: "Why did you roll back?" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/v1/text-to-speech/");
    expect(JSON.parse(String(init.body))).toMatchObject({ text: "Why did you roll back?", model_id: "eleven_flash_v2_5" });
  });

  it("rejects empty or oversized text", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", KEY);
    vi.stubGlobal("fetch", vi.fn());
    expect((await speakRoute(speakRequest({ text: "" }))).status).toBe(400);
    expect((await speakRoute(speakRequest({ text: "x".repeat(401) }))).status).toBe(400);
  });
});
