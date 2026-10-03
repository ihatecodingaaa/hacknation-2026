import { connection } from "next/server";
import { SecondShiftApp } from "@/components/SecondShiftApp";
import { voiceConfig } from "@/lib/voice/elevenlabs-server";

export default async function Home() {
  // Read the key at request time, not build time, so deploys pick up env changes.
  await connection();
  return <SecondShiftApp voiceConfigured={voiceConfig() !== null} />;
}
