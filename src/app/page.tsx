import { connection } from "next/server";
import { SecondShiftApp } from "@/components/SecondShiftApp";
import { AGENT_LABEL, reasoningConfig } from "@/lib/reasoning/provider";
import { voiceConfig } from "@/lib/voice/elevenlabs-server";

export default async function Home({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  // Read the keys at request time, not build time, so deploys pick up env changes.
  await connection();
  const { view } = await searchParams;
  return (
    <SecondShiftApp
      voiceConfigured={voiceConfig() !== null}
      reasoning={{ configured: reasoningConfig() !== null, label: AGENT_LABEL }}
      initialView={view === "analyst" ? "analyst" : "judge"}
    />
  );
}
