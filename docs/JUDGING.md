# Judging evidence

Every claim below points at code or a test. Paths are relative to the repo root.

## Technical depth

**A hybrid extraction pipeline with a hard trust boundary.**
A language model may read the transcript and propose claims; it never creates a rule.
- Strict schema for model output (`SemanticCandidatesSchema`, zod) with bounded strings and arrays, enumerated signal and action ids: `src/domain/semantic.ts`.
- Four deterministic gates before a claim is learned: provenance (the quote must be traceable to the transcript, `locateQuote` in `src/domain/speech.ts`), quote support (the expert's words, within their own clause, must say what the claim says: fixed concept anchors per signal in `src/domain/support.ts`, never telemetry), no hedging or low confidence, and telemetry agreement. Telemetry never rescues words that do not support a claim: a real Scribe mishearing, "The video started right after the deployment", is rejected as evidence of a failure after a deploy even though the telemetry shows one (`tests/domain/quote-support.test.ts`). The phrase-matcher fallback passes through the same support check. Tests: `tests/domain/semantic.test.ts` (invented quotes, contradicted claims, unmapped and hedged claims, malformed JSON, fallback on bad payloads).
- Code also decides hedging (hedge words in the claim's clause block it) and negation (a traced quote can never add, drop or skip a "not"). Regressions: `tests/domain/review-regressions.test.ts`.
- The extractor is not shown the telemetry. Test: `extraction prompt` in `tests/voice/reasoning.test.ts`.
- Disfluency-tolerant matching that never rewrites the source: matching runs on a cleaned copy, spans are mapped back, and evidence always quotes the original words (`normalizeSpeech`, `toOriginalSpan`).

**Learning a decision boundary, not a script.**
- Divergence detection gates learning: if the expert follows the runbook, nothing is asked or learned (`src/domain/divergence.ts`).
- Counterfactual selection is deterministic: a cited signal with an observed but uncited sibling of the same kind (`src/domain/counterfactual.ts`). The answer is read into a draft (stance, alternative, and the words each came from); live and typed answers change the rule only after the expert confirms (`confirmCounterfactual`, `src/domain/session.ts`). "No" marks the condition as boundary-tested and adds a guardrail with the expert's alternative, scoped to what the question held constant; a "no" without an alternative is refused; "yes" broadens the condition. Tests: `tests/domain/counterfactual-gate.test.ts`, including a real garbled Scribe transcript.
- Rule v1 has conditions only. A reason that stops being true leaves the rule silent; explicit guardrails come only from the expert's confirmed counterfactual, so the map's v1 to v2 move is real.
- Tri-state signals: missing telemetry is `unknown`, never guessed, and never fires a guardrail (`src/domain/signals.ts`, `src/domain/evaluation.ts`). A single running version makes scope signals unknown rather than vacuously true.

**Decision Boundary Map computed from the rule.**
`deriveBoundaryMap` (`src/domain/boundary.ts`) builds a coherent one-reason hypothetical for each condition (coupled signals move together), runs the real `matchRule`, and records the previous version's answer when the latest revision moved it. `placeIncident` places a new incident on the same axes and names the deciding condition. Tests: `tests/domain/boundary.test.ts`.

**Portable decision memory, proven complete.**
`compileDecisionMemory` → JSON → `parseDecisionMemory` (schema-validated) → `executeDecisionMemory` reads only the JSON. A test checks that it reproduces the rule engine on all 19 seeded incidents for three rule variants (`tests/domain/memory-benchmark.test.ts`).

**A benchmark that actually runs.**
14 seeded unseen incidents with ground truth written from each fixture's root cause (`src/domain/benchmark.ts`). Runbook-only vs runbook + memory, scored from the serialized artifact, with abstention and harmful actions counted separately. The counterfactual's contribution is isolated (v1 vs v2), and the two remaining misses are shown, not hidden.

**Voice reliability.**
Server-side: one retry after 300 ms for network errors, timeouts and 5xx; never for auth, quota, rate limits or validation (`withRetry`, `isTransient` in `src/lib/voice/elevenlabs-server.ts`). Browser: the token fetch retries once only when the request never reached the server, so retries never multiply. Tests in `tests/voice/routes.test.ts`, including "the key never appears in a response body".

**Engineering hygiene.** 173 tests, lint clean, typed end to end, one Next.js app, no database, no queue, no agent framework. API keys stay on the server; the browser only ever sees a single-use Scribe token.

## Innovation

- **The unit of capture is the exception, not the workflow.** Process mining, SOP generation and screen recording log what happened. SecondShift only engages when an expert's action contradicts the expected one, and asks about that moment.
- **It learns what would have changed the decision.** The counterfactual turns one explanation into a boundary: where the rule applies, where it is silent, where it gives way to a different action. The map makes that visible.
- **It knows what it does not know.** Unverifiable claims are not learned; missing evidence leads to abstention; one incident caps evidence strength.
- **One judgment, two learners.** The same rule coaches a trainee with provenance and runs as a machine-readable policy. The dataset this builds (context, expected action, deviation, rationale, evidence, counterfactual, boundary, guardrail) is one most organisations do not have.
- **Voice is the elicitation channel, not decoration.** The question is asked at the moment of deviation, while the reasoning is fresh; ElevenLabs Scribe captures the answer as the expert says it, disfluencies and all, and that verbatim text is the evidence.

## Communication

- **Story view** shows one idea per screen in the order a first-time viewer needs: Before, Surprise, Why, Boundary, Transfer, Memory. Large type, the palette carries meaning (steel runbook, blue expert, amber divergence, teal learned judgment, red blocked, yellow unknown).
- **Analyst view** keeps the full console for questions: incident telemetry, every step, guardrails, evidence strength factors, evidence list, benchmark table, decision memory.
- **Every visual is computed.** The map cells come from the rule engine; the benchmark squares are graded cases you can click; nothing is a decorative chart.
- **Every source is labelled.** Live transcript, edited transcript, typed, scripted, seeded telemetry, extractor used, fallback reason.
- Docs: `README.md` (what and how), `docs/DEMO.md` (3-minute script with failure fallbacks), `STATUS.md` (what works, what was verified and how).
