import { errorMessage, synthesize, voiceConfig } from "@/lib/voice/elevenlabs-server";

const MAX_CHARS = 400;

/** Speaks SecondShift's questions with ElevenLabs TTS. */
export async function POST(request: Request) {
  const config = voiceConfig();
  if (!config) {
    return Response.json(
      { error: "ELEVENLABS_API_KEY is not set on the server. Voice output is off." },
      { status: 503 },
    );
  }

  let text = "";
  try {
    const body = (await request.json()) as { text?: unknown };
    text = typeof body.text === "string" ? body.text.trim() : "";
  } catch {
    // fall through to validation
  }
  if (!text || text.length > MAX_CHARS) {
    return Response.json({ error: `text must be 1-${MAX_CHARS} characters` }, { status: 400 });
  }

  try {
    const audio = await synthesize(config, text);
    return new Response(audio, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch (err) {
    return Response.json({ error: errorMessage(err) }, { status: 502 });
  }
}
