// Plays SecondShift's questions through the /api/voice/speak route (ElevenLabs TTS).
// One audio channel: a new line stops the previous one, and a slow response
// for an older line never plays over a newer one.

export type SpeakResult = "played" | "unavailable" | "failed" | "superseded";

let current: HTMLAudioElement | null = null;
let seq = 0;

export function stopSpeaking() {
  seq++;
  current?.pause();
  current = null;
}

export async function speak(text: string): Promise<SpeakResult> {
  stopSpeaking();
  const mine = seq;
  try {
    const res = await fetch("/api/voice/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (res.status === 503) return "unavailable";
    if (!res.ok) return "failed";
    const blob = await res.blob();
    if (mine !== seq) return "superseded";
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    current = audio;
    await audio.play();
    return "played";
  } catch {
    return mine === seq ? "failed" : "superseded";
  }
}
