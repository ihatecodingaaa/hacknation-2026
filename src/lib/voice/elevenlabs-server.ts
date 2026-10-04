// Server-only ElevenLabs calls. Imported by route handlers only, so the API
// key never reaches the browser.

export const API_BASE = "https://api.elevenlabs.io";
const TIMEOUT_MS = 10_000;
/** Pause before the single retry of a transient failure. */
export const RETRY_DELAY_MS = 300;

export const STT_MODEL = "scribe_v2_realtime";
const DEFAULT_TTS_MODEL = "eleven_flash_v2_5";
// "George", a stock voice from the ElevenLabs docs. Override with ELEVENLABS_VOICE_ID.
const DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";

export interface VoiceConfig {
  apiKey: string;
  voiceId: string;
  ttsModel: string;
}

export function voiceConfig(): VoiceConfig | null {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    voiceId: process.env.ELEVENLABS_VOICE_ID?.trim() || DEFAULT_VOICE_ID,
    ttsModel: process.env.ELEVENLABS_TTS_MODEL?.trim() || DEFAULT_TTS_MODEL,
  };
}

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function upstreamMessage(res: Response): Promise<string> {
  const body = await res.text().catch(() => "");
  try {
    const json = JSON.parse(body) as { detail?: { message?: string } | string };
    if (typeof json.detail === "string") return json.detail;
    if (json.detail?.message) return json.detail.message;
  } catch {
    // not JSON
  }
  return body.slice(0, 200) || res.statusText;
}

/**
 * Transient = worth one more try: a network error, a timeout, or a 5xx from
 * ElevenLabs. Auth, quota, rate-limit and validation errors (4xx) are not
 * retried: trying again would fail the same way, or make a rate limit worse.
 */
export function isTransient(err: unknown): boolean {
  if (err instanceof UpstreamError) return err.status >= 500;
  if (err instanceof Error) {
    return err.name === "TimeoutError" || err.name === "AbortError" || err.name === "TypeError";
  }
  return false;
}

/** Run once; on a transient failure wait briefly and run exactly once more. */
export async function withRetry<T>(fn: () => Promise<T>, delayMs = RETRY_DELAY_MS): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isTransient(err)) throw err;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return fn();
  }
}

/** Mint a single-use token the browser can use for one Scribe Realtime session. */
export async function createScribeToken(config: VoiceConfig): Promise<string> {
  return withRetry(async () => {
    const res = await fetch(`${API_BASE}/v1/single-use-token/realtime_scribe`, {
      method: "POST",
      headers: { "xi-api-key": config.apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new UpstreamError(`ElevenLabs token request failed (${res.status}): ${await upstreamMessage(res)}`, res.status);
    }
    const json = (await res.json()) as { token?: string };
    if (!json.token) throw new UpstreamError("ElevenLabs returned no token", 502);
    return json.token;
  });
}

/** Text to speech. Returns MP3 bytes. */
export async function synthesize(config: VoiceConfig, text: string): Promise<ArrayBuffer> {
  return withRetry(() => synthesizeOnce(config, text));
}

async function synthesizeOnce(config: VoiceConfig, text: string): Promise<ArrayBuffer> {
  const url = `${API_BASE}/v1/text-to-speech/${encodeURIComponent(config.voiceId)}?output_format=mp3_44100_128`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": config.apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({ text, model_id: config.ttsModel }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new UpstreamError(`ElevenLabs TTS failed (${res.status}): ${await upstreamMessage(res)}`, res.status);
  }
  return res.arrayBuffer();
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") return "ElevenLabs did not respond in time";
    return err.message;
  }
  return "Unknown error";
}
