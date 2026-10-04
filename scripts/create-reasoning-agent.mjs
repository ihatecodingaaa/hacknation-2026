// One-time setup: creates the ElevenLabs agent SecondShift uses for semantic
// reasoning extraction (text-only, no voice), and prints its id.
//
//   node --env-file=.env.local scripts/create-reasoning-agent.mjs
//
// Then add ELEVENLABS_REASONING_AGENT_ID=<id> to .env.local.
// The detailed instructions travel with each request (src/lib/reasoning/prompt.ts),
// so the agent's own prompt only has to keep replies to bare JSON.

const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
if (!apiKey) {
  console.error("ELEVENLABS_API_KEY is not set. Run with: node --env-file=.env.local scripts/create-reasoning-agent.mjs");
  process.exit(1);
}
const llm = process.env.ELEVENLABS_REASONING_LLM?.trim() || "gemini-2.5-flash";

const body = {
  name: "SecondShift reasoning extractor",
  conversation_config: {
    agent: {
      first_message: "",
      language: "en",
      prompt: {
        prompt:
          "You are SecondShift's reasoning extractor. Each user message contains instructions, a JSON Schema and an expert's transcript. " +
          "Reply with exactly one JSON object that follows the schema. No prose, no markdown, no greeting.",
        llm,
        temperature: 0,
        ignore_default_personality: true,
      },
    },
    conversation: { text_only: true },
  },
};

const res = await fetch("https://api.elevenlabs.io/v1/convai/agents/create", {
  method: "POST",
  headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const text = await res.text();
if (!res.ok) {
  console.error(`Agent creation failed (${res.status}): ${text.slice(0, 400)}`);
  process.exit(1);
}
const { agent_id: agentId } = JSON.parse(text);
console.log(`Created agent ${agentId} (LLM: ${llm}).`);
console.log(`Add to .env.local:\nELEVENLABS_REASONING_AGENT_ID=${agentId}`);
