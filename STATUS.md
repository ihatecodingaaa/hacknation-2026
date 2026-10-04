# Status

Last updated: 2026-10-04 (branch `cloud/secondshift-winning-pass`)

## Current state

The full demo works end to end with or without keys: divergence → why (voice) → verified claims → rule v1 → counterfactual → rule v2 → Decision Boundary Map → trainee transfer on four cases → seeded benchmark → decision memory artifact. Two presentations share one session: **Story view** (default, six chapters for a first-time viewer) and **Analyst view** (`/?view=analyst`, the full console).

## Works

- Everything listed for the baseline (runbook prediction, divergence, grounded rule, counterfactual, guardrails, four trainee cases with provenance, labelled fallback).
- **Semantic candidate extraction** through ElevenLabs Agents (text-only chat mode) behind a provider interface, enabled by `ELEVENLABS_REASONING_AGENT_ID`. Output must pass a strict zod schema. Every claim is then verified by code: quote traced to the transcript, observable signal, not hedged or low-confidence, telemetry agrees. Only supported claims are learned. The UI shows rejected candidates and the model's interpretation, labelled as not evidence.
- **Phrase matcher** kept as fallback and cross-check, now tolerant of fillers, repeats and cut-off words, with spans mapped back to the original transcript.
- **Decision Boundary Map** computed from the rule; marks the cell the counterfactual moved; places trainee incidents with the deciding condition highlighted.
- **Seeded benchmark** (14 cases): runbook only 5/14 correct; + memory v1 10/14 (1 abstained, 3 incorrect); + memory v2 11/14 (1 abstained, 2 incorrect). Computed from the serialized artifact, pinned by a test. Numbers come from the scripted expert answers; recomputed after the boundary change below and unchanged, because the removed v1 guardrails only ever handed control to the runbook, the same action as "rule is silent". A story that probes version scope instead reaches 12/14.
- **Counterfactual confirmation gate** (after a live run where Scribe garbled the answer and a leading "No" was accepted): the answer is a draft showing the transcript, the reading and the words it came from. Live and typed answers change the rule only after the expert clicks **Confirm interpretation**; **Correct it** reopens. A "no" without an alternative is never applied. The scripted answer is still applied in one step and labelled as such.
- **Boundary semantics:** rule v1 has conditions only; the opposite of a stated reason no longer becomes a guardrail. A confirmed counterfactual adds the guardrail (scoped to what the question held constant), so the map shows a real move, e.g. "If every version was failing: was Rule is silent, now Hold and investigate". Trainee case B (every version failing) now reads "Roll back deployment is not supported by the expert's rule" instead of a guardrail block.
- **Story chapters open at their heading:** the chapter pane and, on narrow screens, the window are reset on every chapter change, and focus moves to the heading.
- **Decision memory** artifact (`secondshift.decision-memory/v1`): schema-validated JSON, an interpreter that reads only the JSON, agent-context text, download.
- **Voice retries:** server retries token and TTS calls once on network errors, timeouts and 5xx; never on 4xx. The browser retries the token fetch once only if the request never reached the server.
- **Signal fix:** with a single running version, both scope signals are now `unknown` (previously "every version failing" was vacuously present).
- "Confidence" is now labelled **evidence strength**, a heuristic sum of visible factors, not a probability.
- **Quote-support gate** (after a live run where Scribe heard "The video started right after the deployment" and the extractor proposed it as "failure began right after a deploy", which the telemetry agreed with): a claim is now learned only if the expert's words, within their own clause, support the claimed signal. Fixed concept anchors per signal (`src/domain/support.ts`), checked before hedging and telemetry, for model observations, causal claims and the phrase-matcher fallback alike. Rejections show *quote does not support claim* with the reason. Side effect, intended: "it started right after the deploy" names no failure, so that timing claim is no longer learned.
- **Hardening from an adversarial review** (each has a regression test in `tests/domain/review-regressions.test.ts`): quote tracing can never add, drop or skip a negation; hedge words ("maybe", "might", "not sure"...) in a claim's clause block it in both extractors, including causal claims; the cut-off-word cleanup only removes a fragment that the next word restarts, so "normal- only" is not flipped; a "yes, still" counterfactual on a rule's only condition keeps the condition instead of producing an empty rule; an empty rule never applies in either engine; a model-proposed "why not" must be about the runbook action; model wording is never displayed as the expert's quote.

## Verified, and how

- Live ElevenLabs Scribe v2 Realtime + TTS with a real key and microphone: run locally by Lucas after the baseline commit (reported: both answers transcribed, rule v1 and v2 created, provenance carried the live source). One transient `502` on `/api/voice/scribe-token` was seen and succeeded on retry; that is what the new retry handles.
- Not verifiable from the cloud build environment: `api.elevenlabs.io` is blocked there and no key is available. With a fake key, the proxy's `403` was surfaced in the UI as the token error, was not retried (4xx), and the semantic extractor fell back to the phrase matcher with the reason shown.
- ElevenLabs Agents extractor: message shapes taken from the official `@elevenlabs/client` and `@elevenlabs/elevenlabs-js` source; tested against a simulated socket (init, user message, ping/pong, ignoring a greeting, timeout, auth failure). **Not yet run against the live API.**
- Browser runs (Playwright, production build): every Story chapter and both Analyst tabs at 1920×1080 and 1440×900, all four trainee cases, no console errors, no horizontal overflow; mobile 390×844 with no page or pane overflow. A semantic success response was injected with request interception to check how the UI renders it (test only, not shipped).
- Quote support, in the browser (Why screen, injected extractor responses): "The video started right after the deployment" shows *Failure began right after a deploy · rejected: quote does not support claim* and rule v1 keeps only the scope condition; "The failures started right after the deployment" shows *supported* and both conditions are learned.
- Counterfactual gate and boundary move, in the browser: typed answers (same gate as live voice) for the scope story ("It broke right after the deployment and only the new version is affected." then "No, I would investigate."): the map stays at v1 while the reading is pending and shows "Moved in v2 · was: Rule is silent · Hold and investigate" only after **Confirm interpretation**; **Correct it** returns it to v1. The garbled transcript keeps **Confirm** disabled until an alternative is picked. Chapter changes checked at 1920×1080, 1440×900 and 900×800 after scrolling to the bottom: the heading is visible every time.
- The live voice path for the counterfactual has not been re-run since these changes (no key here); the gate is the same for live and typed answers and is unit-tested with `elevenlabs_live` sources.

## Tests run

- `npm test`: 14 files, 173 tests, all passing.
- `npm run lint`: clean.
- `npm run build`: passes. Routes: `/`, `/api/voice/status`, `/api/voice/scribe-token`, `/api/voice/speak`, `/api/reasoning/extract`.

## Known problems / limitations

- The Agents extractor needs one local run with a real key before it is relied on in a presentation (see Next task). The demo does not depend on it.
- Phrase matcher vocabulary is 7 signals; it fails safe outside it.
- No persistence; refresh resets. Telemetry is seeded.
- `npm audit` reports 5 high advisories in dev-only ESLint tooling (`braces` via `eslint-config-next`); the suggested fix downgrades `eslint-config-next`, so it was left alone.
- `AGENTS.md` contains em dashes; it is generated by `next dev` and was left untouched.

## Next task

1. Locally: `npm run setup:reasoning-agent`, put the printed id in `.env.local` as `ELEVENLABS_REASONING_AGENT_ID`, restart, and answer the "why" question by voice. Check the claims footer says *Claims proposed by: ElevenLabs Agents (text-only)*. If it shows a fallback reason instead, the demo still works; remove the variable to silence it.
2. Rehearse `docs/DEMO.md` twice: once live, once with scripted answers.
3. Deploy with the keys as server environment variables (the microphone needs HTTPS).
