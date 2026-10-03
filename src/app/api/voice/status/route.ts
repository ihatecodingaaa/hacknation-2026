import { STT_MODEL, voiceConfig } from "@/lib/voice/elevenlabs-server";

export const dynamic = "force-dynamic";

/** Reports whether a key is configured. It does not prove the key works. */
export async function GET() {
  const config = voiceConfig();
  return Response.json({
    configured: Boolean(config),
    sttModel: STT_MODEL,
    ttsModel: config?.ttsModel ?? null,
  });
}
