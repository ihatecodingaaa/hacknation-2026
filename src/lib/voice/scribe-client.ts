// Browser client for ElevenLabs Scribe v2 Realtime.
//
// Flow: ask our server for a single-use token, open the documented WebSocket,
// stream 16 kHz mono PCM from the microphone as base64 input_audio_chunk
// messages, and collect partial / committed transcripts.
// Protocol: https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime

const WS_URL = "wss://api.elevenlabs.io/v1/speech-to-text/realtime";
const TARGET_RATE = 16_000;
const CHUNK_SAMPLES = 1_600; // 100 ms at 16 kHz
const FINAL_WAIT_MS = 2_500;

const ERROR_TYPES = new Set([
  "error",
  "auth_error",
  "quota_exceeded",
  "commit_throttled",
  "unaccepted_terms",
  "rate_limited",
  "queue_overflow",
  "resource_exhausted",
  "session_time_limit_exceeded",
  "input_error",
  "invalid_request",
  "chunk_size_exceeded",
  "insufficient_audio_activity",
  "transcriber_error",
]);

// Taps raw microphone frames off the audio thread.
const WORKLET_SOURCE = `
class PcmTap extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("pcm-tap", PcmTap);
`;

export interface ScribeHandlers {
  onTranscript: (text: string, partial: string) => void;
  onLevel?: (rms: number) => void;
  onError: (message: string) => void;
}

function toBase64Pcm16(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Box-filter resampler that keeps the fractional remainder between calls. */
class Resampler {
  private pending: number[] = [];
  constructor(private readonly ratio: number) {}

  push(frame: Float32Array): Float32Array {
    for (let i = 0; i < frame.length; i++) this.pending.push(frame[i]);
    const outLen = Math.floor(this.pending.length / this.ratio);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const start = Math.floor(i * this.ratio);
      const end = Math.max(start + 1, Math.floor((i + 1) * this.ratio));
      let sum = 0;
      for (let j = start; j < end; j++) sum += this.pending[j];
      out[i] = sum / (end - start);
    }
    this.pending = this.pending.slice(Math.floor(outLen * this.ratio));
    return out;
  }
}

async function fetchToken(): Promise<string> {
  const res = await fetch("/api/voice/scribe-token", { method: "POST" });
  const json = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
  if (!res.ok || !json.token) {
    throw new Error(json.error ?? `Token request failed (${res.status})`);
  }
  return json.token;
}

export class ScribeSession {
  private committed: string[] = [];
  private partial = "";
  private buffer: number[] = [];
  private stopping = false;
  private finalResolver: (() => void) | null = null;

  private constructor(
    private readonly ws: WebSocket,
    private readonly ctx: AudioContext,
    private readonly stream: MediaStream,
    private readonly node: AudioWorkletNode,
    private readonly handlers: ScribeHandlers,
  ) {}

  static async start(handlers: ScribeHandlers): Promise<ScribeSession> {
    const token = await fetchToken();

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      throw new Error("Microphone permission was denied or no microphone is available");
    }

    const params = new URLSearchParams({
      model_id: "scribe_v2_realtime",
      token,
      audio_format: "pcm_16000",
      commit_strategy: "vad",
      language_code: "en",
    });
    const ws = new WebSocket(`${WS_URL}?${params}`);

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("ElevenLabs connection timed out")), 8_000);
        ws.onopen = () => {
          clearTimeout(timer);
          resolve();
        };
        ws.onerror = () => {
          clearTimeout(timer);
          reject(new Error("Could not connect to ElevenLabs Scribe"));
        };
      });
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      throw err;
    }

    const ctx = new AudioContext();
    const moduleUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
    await ctx.audioWorklet.addModule(moduleUrl);
    URL.revokeObjectURL(moduleUrl);
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "pcm-tap");
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(node).connect(mute).connect(ctx.destination);

    const session = new ScribeSession(ws, ctx, stream, node, handlers);
    session.wire(new Resampler(ctx.sampleRate / TARGET_RATE));
    return session;
  }

  private wire(resampler: Resampler) {
    this.ws.onmessage = (event) => {
      let msg: { message_type?: string; text?: string; error?: string };
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const type = msg.message_type ?? "";
      if (type === "partial_transcript") {
        this.partial = msg.text ?? "";
        this.emit();
      } else if (type === "committed_transcript") {
        if (msg.text?.trim()) this.committed.push(msg.text.trim());
        this.partial = "";
        this.emit();
        this.finalResolver?.();
      } else if (ERROR_TYPES.has(type)) {
        // A commit with nothing left to commit is expected while stopping.
        if (this.stopping) {
          this.finalResolver?.();
          return;
        }
        this.handlers.onError(`ElevenLabs ${type}: ${msg.error ?? "unknown error"}`);
      }
    };
    this.ws.onclose = (event) => {
      if (!this.stopping && event.code !== 1000) {
        this.handlers.onError(`ElevenLabs connection closed (${event.code}${event.reason ? `: ${event.reason}` : ""})`);
      }
      this.finalResolver?.();
    };

    this.node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      const frame = event.data;
      if (this.handlers.onLevel) {
        let sum = 0;
        for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
        this.handlers.onLevel(Math.sqrt(sum / frame.length));
      }
      const out = resampler.push(frame);
      for (let i = 0; i < out.length; i++) this.buffer.push(out[i]);
      if (this.buffer.length >= CHUNK_SAMPLES) this.flush(false);
    };
  }

  private flush(commit: boolean) {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    const samples = Float32Array.from(this.buffer);
    this.buffer = [];
    this.ws.send(
      JSON.stringify({
        message_type: "input_audio_chunk",
        audio_base_64: toBase64Pcm16(samples),
        commit,
        sample_rate: TARGET_RATE,
      }),
    );
  }

  private emit() {
    this.handlers.onTranscript(this.text(), this.partial);
  }

  private text(): string {
    return [...this.committed, this.partial].filter(Boolean).join(" ").trim();
  }

  private releaseAudio() {
    this.node.port.onmessage = null;
    this.stream.getTracks().forEach((t) => t.stop());
    void this.ctx.close().catch(() => undefined);
  }

  /** Stop the mic, commit what is left, wait briefly for the final text. */
  async stop(): Promise<string> {
    if (this.stopping) return this.text();
    this.stopping = true;
    this.releaseAudio();
    if (this.ws.readyState === WebSocket.OPEN) {
      const final = new Promise<void>((resolve) => {
        this.finalResolver = resolve;
        setTimeout(resolve, FINAL_WAIT_MS);
      });
      this.flush(true);
      await final;
      this.ws.close(1000);
    }
    return this.text();
  }

  cancel() {
    this.stopping = true;
    this.releaseAudio();
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close(1000);
    }
  }
}

/** Play a line through ElevenLabs TTS. Resolves to what actually happened. */
export async function speak(text: string): Promise<"played" | "unavailable" | "failed"> {
  try {
    const res = await fetch("/api/voice/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (res.status === 503) return "unavailable";
    if (!res.ok) return "failed";
    const url = URL.createObjectURL(await res.blob());
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    await audio.play();
    return "played";
  } catch {
    return "failed";
  }
}
