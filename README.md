# SecondShift

**SecondShift learns what changes an expert's mind.**

When a senior engineer ignores the runbook, that decision holds knowledge nobody wrote down. SecondShift notices the moment, asks the expert why (by voice, through ElevenLabs), checks every reason against the telemetry, probes where the reason stops applying with one counterfactual question, and compiles the result into decision memory that can coach a trainee or be read by software.

Built for **Hack-Nation 2026, ElevenLabs challenge: The AI Apprentice.**

---

## Why workflow capture is not enough

Existing tools capture what experts do: screen recordings, SOP generators, process and task mining, RAG over the wiki. They record that the expert rolled back. They do not record the condition that made rollback right, or the case where it would be wrong.

That condition is the valuable part. It only shows up when the expert's action differs from the obvious one, and it only becomes reusable once you know its edges. SecondShift is built around exactly those two moments: **the deviation** and **the boundary**.

## Hero scenario

`checkout-api` is throwing 5xx errors. The runbook says **restart the service**. The on-call expert **rolls back the deployment** instead.

1. **Before.** SecondShift predicts the runbook action from the telemetry (RB-3, error rate elevated).
2. **Surprise.** The expert's action differs. SecondShift names what the runbook ignored: deploy timing, version scope, latency.
3. **Why.** It asks, out loud: *"You rolled back instead of restarting. What made you choose that?"* The expert answers by microphone; Scribe v2 Realtime transcribes it.
4. **Verify.** Each claim in the answer is checked against telemetry. Supported claims become rule conditions. Contradicted, unverifiable or invented claims are shown and not learned.
5. **Boundary.** It asks one counterfactual: *"If latency increased but the error rate stayed normal, would you still roll back?"* The answer ("No, I'd investigate first") is read into a draft that shows the transcript, the reading and the words it came from. Once the expert confirms it, the rule moves: the Decision Boundary Map shows the cell change from *Rule is silent* to *Hold and investigate*.
6. **Transfer.** A trainee on a different incident (different service and numbers) chooses restart. SecondShift flags the mismatch and shows the expert's original words as the reason. On an incident where every version fails, the rule's scope condition does not hold, so it does not support rolling back. Where per-version data is missing, it abstains.
7. **Memory.** The same judgment is exported as a versioned JSON artifact. An evaluator that reads only that file runs it on 14 seeded incidents against a runbook-only baseline.

## How it works

```
expert's voice ─► Scribe v2 Realtime ─► transcript (verbatim, tagged with its source)
                                            │
             ┌──────────────────────────────┴───────────────────────────┐
             ▼                                                          ▼
 semantic extractor (optional)                             phrase matcher (deterministic)
 ElevenLabs Agents, text-only                              fallback and cross-check,
 PROPOSES observations, causal claims,                     tolerant of "uh", repeats,
 the rejected alternative, hedges                          cut-off words
             │ strict zod schema                                        │
             └────────────────────────────┬─────────────────────────────┘
                                          ▼
                              deterministic verifier DECIDES
                  1. provenance: quoted words are really in the transcript
                  2. quote support: those words say what the claim says
                  3. not hedged      4. the telemetry agrees
                                          ▼
                 rule v1: only supported claims; no guardrails yet
                                          ▼
          counterfactual chosen by code (cited signal vs uncited sibling), spoken by TTS
                                          ▼
          answer read into a draft; the expert confirms or corrects the reading
                                          ▼
           rule v2: condition marked boundary-tested, counterfactual guardrail added
                 │                      │                          │
                 ▼                      ▼                          ▼
        Decision Boundary Map    trainee grading with      decision memory (JSON)
        (flip each reason,       provenance to the         ─► seeded benchmark
         run the real matcher)   expert's words            ─► agent-context text
```

**The model proposes; code decides.** A language model is good at reading messy speech ("that, that the de- the deployment caused the accident, the incident"). It is not trusted to decide what is true. So the semantic extractor only returns candidates, and four deterministic checks decide which of them are learned. The second check reads only the expert's words: in a live run Scribe heard "The **video** started right after the deployment"; the extractor mapped it to "failure began right after a deploy", and the telemetry does show that, but the words do not say anything failed, so the claim is rejected (*quote does not support claim*). Telemetry agreement never rescues words that do not support a claim. The extractor is not shown the telemetry, so it cannot fit claims to the data that will check them.

**Everything that needs an exact answer is plain TypeScript:** signal derivation from telemetry, the runbook prediction, divergence detection, verification, rule building, counterfactual selection, rule matching, guardrails, trainee grading, the boundary map and the benchmark. A trainee verdict is identical every time and can be traced to its source.

## The pieces worth inspecting

| Concern | Where | What to look for |
|---|---|---|
| Signals from telemetry | `src/domain/signals.ts` | Tri-state (present / absent / unknown). Missing data is never guessed. |
| Runbook and divergence | `playbook.ts`, `divergence.ts` | No divergence means no question and nothing learned. |
| Semantic candidates + verification | `semantic.ts`, `speech.ts`, `support.ts` | zod schema, quote tracing with disfluency tolerance, a quote-support check per signal, four gates. |
| Phrase matcher | `extraction.ts` | Matches on a cleaned copy; every span maps back to the original words. |
| Rule + evidence strength | `rules.ts` | Conditions carry the expert's quote and the version that introduced them. |
| Counterfactual | `counterfactual.ts`, `session.ts` | Picks a cited signal with an uncited sibling. The answer is a draft until the expert confirms it; "no" plus an alternative confirms the condition and adds a guardrail scoped to what the question held constant, "yes" broadens it. A "no" without an alternative is never applied. |
| Matching and grading | `evaluation.ts` | Guardrails first; unknown data never fires anything. |
| Decision Boundary Map | `boundary.ts` | Each cell is `matchRule()` on a one-reason hypothetical. |
| Decision memory | `memory.ts` | Schema-validated artifact plus an interpreter that reads only the JSON. |
| Benchmark | `benchmark.ts` | 14 seeded cases, ground truth from each fixture's designed cause. |
| ElevenLabs server calls | `src/lib/voice/elevenlabs-server.ts`, `src/lib/reasoning/provider.ts` | Key stays server-side; one retry for transient failures only. |

## ElevenLabs

| Capability | API | Used for |
|---|---|---|
| Speech to text, streaming | **Scribe v2 Realtime** (`scribe_v2_realtime`) over WebSocket, browser authenticated with a server-minted single-use token | The expert's answers to "why" and to the counterfactual |
| Text to speech | `POST /v1/text-to-speech/{voice_id}`, `eleven_flash_v2_5` | Asking both questions aloud |
| Agents, text-only chat mode (optional) | Signed URL from `GET /v1/convai/conversation/get-signed-url`, then the conversation WebSocket (`user_message` in, `agent_response` out) | Semantic candidate extraction from the transcript |

The live Scribe and TTS path has been run with a real key and a real microphone: the transcript carried *ElevenLabs Scribe v2 Realtime · live* into rule v1, rule v2 and the trainee provenance. The Agents extractor follows the message shapes of the official `@elevenlabs/client` SDK and is covered by protocol tests against a simulated socket; it has **not** yet been run against the live API (see Limitations).

**What is sent where.** Scribe receives the microphone audio. TTS receives the two question strings. The Agents extractor (only if configured) receives the transcript, the question, the service name, deploy versions, the runbook step and the two actions; it does not receive telemetry values. Nothing is stored server-side and transcripts are not logged. The provider sits behind a one-method interface (`SemanticReasoningProvider`) so an organisation can substitute a privately hosted model.

## Decision Boundary Map

Columns are the reasons the expert gave (rule conditions). Rows ask the rule engine what it recommends on the expert's own incident when that one reason **holds**, **stops being true**, or **cannot be measured**. Every cell is computed by running the real matcher on that hypothetical, not drawn by hand. Before any boundary is tested, a reason that stops being true leaves the rule *silent* (the runbook applies): rule v1 does not invent a policy for the opposite of what the expert said. After the confirmed counterfactual, the probed cell changes from *Rule is silent* to *Hold and investigate* and is marked *Moved in v2*. Whichever reason the counterfactual probes moves the same way (for example version scope: "If every version was failing"). In the transfer step the trainee's incident is placed on the same axes, the deciding column is outlined, and a result line says where it landed and why. Selecting a column shows the expert's quote, the telemetry and the counterfactual behind it.

## Benchmark (seeded)

`src/domain/benchmark.ts` holds 14 incidents the expert never saw: clean matches, a CPU-saturating bad deploy, a noisy baseline, a timing mismatch, a late-triggering bad deploy, an upstream outage, latency-only with and without a deploy, a database incident, a traffic surge, missing per-version data, a 100% rollout, and an ordinary runbook case. Each case's correct response is written from its designed root cause, independently of any policy.

The evaluator compares **runbook only** with **runbook + decision memory**, and memory is loaded from the serialized JSON artifact. With the scripted expert answers the harness currently produces:

| Policy | Correct | Abstained | Incorrect |
|---|---|---|---|
| Runbook only | 5 / 14 | 0 | 9 |
| + memory v1 (before the counterfactual) | 10 / 14 | 1 | 3 |
| + memory v2 (after the counterfactual) | 11 / 14 | 1 | 2 |

The counterfactual fixes BM-08 (latency up, errors flat, right after a deploy). The two remaining misses are honest: BM-06 is a bad deploy that fires 30 minutes later, outside the expert's stated timing, and BM-07 is an upstream outage where the right move is to investigate; the rule correctly does not apply, but the runbook's restart is still wrong. If the expert names deploy timing and version scope only and the counterfactual probes version scope ("If the failures weren't isolated to the new version...", answered "No, I would investigate"), v2 reaches 12/14 because BM-07 then gets "investigate". These numbers are computed in the app and pinned by tests; a different expert answer gives different numbers. They are fixtures, not production performance.

## Decision memory

`compileDecisionMemory()` turns the rule into `secondshift.decision-memory/v1`: conditions (with the expert's quote and the version that introduced or tested them), guardrails in precedence order, evidence requirements, an explicit missing-evidence policy (abstain), provenance, revision history, evidence strength and how each signal is measured. `executeDecisionMemory()` applies it from the JSON alone; a test shows it reproduces the rule engine on all 19 seeded incidents. `renderAgentContext()` turns the same file into plain text that could be given to an agent as context or used as a policy check. No autonomous agent runs in this app.

## Fallback and honesty

- **No `ELEVENLABS_API_KEY`:** the app is fully demoable. Answers can be typed or taken from a scripted answer. Scripted text is tagged *Scripted demo answer · not live* wherever it appears, including rule evidence and trainee provenance.
- **No `ELEVENLABS_REASONING_AGENT_ID`:** claims come from the phrase matcher, and the UI says so.
- **A live call fails:** the reason from ElevenLabs is shown where it happened and the typed or scripted path stays available. A semantic failure falls back to the phrase matcher with the reason shown.
- Incident telemetry is seeded and labelled *Seeded demo incident · not live telemetry*.
- Evidence strength is a sum of visible factors, capped at 0.85 because it comes from one incident. It is labelled as a heuristic, not a probability.

## Setup

```bash
npm install
cp .env.example .env.local          # optional: add keys for live voice
npm run dev                         # http://localhost:3000  (Story view)
                                    # http://localhost:3000/?view=analyst
```

Optional semantic extraction through ElevenLabs Agents:

```bash
npm run setup:reasoning-agent       # creates a text-only agent, prints its id
# add ELEVENLABS_REASONING_AGENT_ID=<id> to .env.local and restart
```

| Variable | Required | Purpose |
|---|---|---|
| `ELEVENLABS_API_KEY` | for live voice | Scribe token minting and TTS, server-side only |
| `ELEVENLABS_VOICE_ID`, `ELEVENLABS_TTS_MODEL` | no | TTS overrides |
| `ELEVENLABS_REASONING_AGENT_ID` | for semantic extraction | Agent created by the setup script |
| `ELEVENLABS_REASONING_LLM` | no | LLM for the setup script (default `gemini-2.5-flash`) |
| `SECONDSHIFT_SEMANTIC=off` | no | Force the phrase matcher even when an agent is configured |

The microphone needs a secure context: `localhost` or HTTPS. Node 20.9+ runs the app; the test runner needs Node 22.12+.

```bash
npm test          # 173 tests: domain, semantic verification, quote support, counterfactual gate, boundary, memory, benchmark, routes, retries
npm run lint
npm run build
```

## Demo

Story view walks through the six chapters in order: Before, Surprise, Why, Boundary, Transfer, Memory. The exact script is in [`docs/DEMO.md`](docs/DEMO.md). The judging evidence, with file references, is in [`docs/JUDGING.md`](docs/JUDGING.md).

## What is live and what is seeded

| Live (with keys) | Seeded |
|---|---|
| Microphone capture, Scribe v2 Realtime transcription, TTS questions | Incident telemetry (5 scenario incidents, 14 benchmark incidents) |
| Semantic extraction through ElevenLabs Agents, if configured | Scripted fallback answers (always labelled) |
| All verification, rule learning, grading, boundary map, benchmark and memory are computed live from whatever the expert said | Benchmark ground-truth labels |

## Limitations

- The ElevenLabs Agents extractor has been run locally with a real key; in this repository it is tested against a simulated socket. If it fails, the phrase matcher takes over and the UI shows why.
- The phrase matcher and the quote-support check use fixed concept words for the 7 signals in this demo. They fail safe: a reason worded outside them is shown and not learned (for example "it started right after the deploy" names no failure, so the timing claim is not learned).
- The counterfactual answer is read by simple rules (a leading "no", "would still", action words). That is why live and typed answers always wait for the expert to confirm the reading.
- One expert, one incident, one rule, one counterfactual. Evidence strength is capped accordingly.
- No persistence: a refresh starts over. No real monitoring integration.
- The benchmark is 14 hand-built fixtures that probe specific boundaries. It shows the mechanism works and where it fails; it says nothing about production accuracy.
- The runbook is a fixed five-step list.

## Where this goes next (six months)

1. Trigger on real deviations: a rollback command, a feature-flag flip, a ticket closed against the runbook.
2. Accumulate decision memory across incidents and experts. Confirming cases raise evidence strength past the single-incident cap; conflicting experts surface as an explicit disagreement to resolve, never an average.
3. Choose counterfactuals by expected information gain across many rules, not one pivot.
4. Serve decision memory to the systems that act: a policy check in front of an automated remediation, or context for an operations agent, with the same provenance.
5. Expand from SRE to other expert operations with playbooks, exceptions and digital evidence: security operations, fraud review, claims, industrial troubleshooting.

The long-term asset is a dataset most organisations do not have: not what happened, but what would have changed the decision.
