import { describe, expect, it } from "vitest";
import { Resampler, toBase64Pcm16 } from "@/lib/voice/scribe-client";

describe("PCM encoding for Scribe input_audio_chunk", () => {
  it("encodes float samples as little-endian 16-bit PCM in base64", () => {
    const b64 = toBase64Pcm16(Float32Array.from([0, 1, -1, 0.5, 2]));
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    const samples = Array.from({ length: bytes.length / 2 }, (_, i) => view.getInt16(i * 2, true));
    expect(samples).toEqual([0, 32767, -32768, 16383, 32767]);
  });
});

describe("Resampler", () => {
  it("downsamples 48 kHz to 16 kHz without losing samples across frames", () => {
    const r = new Resampler(48_000 / 16_000);
    let total = 0;
    for (let i = 0; i < 375; i++) total += r.push(new Float32Array(128).fill(0.25)).length; // 1 s of audio
    expect(total).toBe(16_000);
  });

  it("handles fractional ratios (44.1 kHz)", () => {
    const r = new Resampler(44_100 / 16_000);
    let total = 0;
    const out: number[] = [];
    for (let i = 0; i < 100; i++) {
      const chunk = r.push(new Float32Array(441).fill(0.5));
      total += chunk.length;
      out.push(...chunk);
    }
    expect(Math.abs(total - 16_000)).toBeLessThanOrEqual(1);
    expect(out.every((v) => Math.abs(v - 0.5) < 1e-6)).toBe(true);
  });
});
