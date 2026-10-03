import { createScribeToken, errorMessage, voiceConfig } from "@/lib/voice/elevenlabs-server";

/** Single-use Scribe Realtime token. The browser never sees the API key. */
export async function POST() {
  const config = voiceConfig();
  if (!config) {
    return Response.json(
      { error: "ELEVENLABS_API_KEY is not set on the server. Running in fallback mode." },
      { status: 503 },
    );
  }
  try {
    const token = await createScribeToken(config);
    return Response.json({ token }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return Response.json({ error: errorMessage(err) }, { status: 502 });
  }
}
