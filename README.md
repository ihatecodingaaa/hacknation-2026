# SecondShift

**SecondShift learns the judgment behind an expert's deviation from the playbook, and teaches it to the next person on call.**

It does not record what the expert does. It notices when the expert does something *different* from the obvious action, asks why at that moment, turns the answer into a rule grounded in what was actually on screen, probes the edge of that rule with one counterfactual question, and then uses the rule to coach a trainee on an incident the expert never saw, with every verdict traced back to the expert's own words.

Built for **Hack-Nation 2026, ElevenLabs challenge: The AI Apprentice.**

---

## The problem

Runbooks capture the obvious move: errors are up, restart the service. Senior engineers often do something else, and the reason lives only in their head: *"the errors started right after the deploy and only the new version is failing, so restarting just restarts the bad code."*

Recording the expert's actions doesn't capture that. A screen recording shows a rollback; it doesn't show the condition that made rollback right, or the case where it would be wrong. When that engineer is asleep, the trainee follows the runbook and restarts the bad build.

## Thesis

The valuable knowledge is at the **decision boundary**: the hidden condition that makes an expert choose differently from the playbook. So SecondShift:

1. **Predicts** the obvious action (the runbook).
2. **Detects divergence** when the expert does something else. If the expert follows the runbook, it stays quiet: there's nothing new to learn.
3. **Asks why** at that moment, by voice.
4. **Grounds** the answer in observed signals. Only reasons the telemetry confirms become rule conditions.
5. **Probes the boundary** with one counterfactual: swap a cited signal for one the expert didn't mention, and ask if the decision survives.
6. **Updates the rule** (version 2), with guardrails, evidence and a confidence score whose factors you can see.
7. **Transfers** it: grades a trainee on a different incident and explains the verdict with provenance back to the expert.

## What the judge sees

```
EXPECTED ACTION  ≠  ACTUAL EXPERT ACTION
        ↓
DECISION DIVERGENCE      (which signals the runbook ignored)
        ↓
WHY? (voice)             "The failures started right after the deployment..."
        ↓
GROUNDED RULE v1         IF failure began right after a deploy
                         AND error rate spiked
                         AND only the new version is failing
                         THEN roll back, not restart
        ↓
COUNTERFACTUAL           "If latency increased but the error rate stayed normal,
                          would you still roll back?"  →  "No, I'd investigate first"
        ↓
RULE v2                  error spike confirmed as required
                         + guardrail: latency without errors → investigate
        ↓
TRAINEE TRANSFER         new incident, trainee restarts → mismatch,
                         with the expert's quote and source telemetry as evidence
```

---

## Demo walkthrough (about 3 minutes)

Run `npm run dev` and open http://localhost:3000.

**Expert shift, INC-2041 (checkout-api)**

1. Left pane: the incident. Signals are derived from telemetry by code: deploy finished 8 min ago, 5xx 0.3% → 9.8%, latency up, only v2.14.0 failing (19.3% vs 0.3%), CPU and DB normal. The chart marks the deploy right before the error climb.
2. Center, step 01: the runbook expects **Restart service** (RB-3: 5xx elevated).
3. Step 02: click **Roll back deployment** as the expert's actual action.
4. Step 03: **Decision divergence** appears, naming the three signals the runbook ignored. Those signals light up amber on the left.
5. Step 04: SecondShift asks *"You rolled back instead of restarting. What made you choose that?"* (spoken via ElevenLabs TTS when a key is set). Answer by voice, type, or click **Use scripted answer** → **Learn from this answer**.
6. Step 05: the transcript is shown with each grounded phrase highlighted and a table: phrase → signal → what the expert claimed → what telemetry shows. Rule v1 appears on the right with two derived guardrails and confidence 0.65 (each factor listed).
7. Step 06: the counterfactual. *"If latency increased but the error rate stayed normal, would you still roll back?"* with the rationale (latency was on screen but not mentioned) and the hypothetical diff. Answer **Use scripted answer** → **Update the rule**.
8. Step 07: rule v1 → v2. On the right, "Error rate spiked" is marked *boundary tested*, a new guardrail *"latency without an error spike → hold and investigate"* is added, confidence 0.65 → 0.85 (capped: one incident is one incident).
9. Click **Test this judgment on a trainee →**.

**Trainee transfer**

10. Case **A** (payments-gateway, different numbers, same pattern). Trainee clicks **Restart service** → **Mismatch with the learned expert rule.** The three-way row shows *Runbook: Restart / Expert rule: Roll back / Trainee: Restart*. The condition table puts INC-2041 and INC-2057 values side by side. The right pane shows provenance: the expert's quote and the source telemetry.
11. Case **B** (edge case): deploy just happened but every version fails (upstream dependency). Click **Roll back** → *blocked by a guardrail*: the rule knows where it stops.
12. Case **C** (boundary): deploy, latency up, errors normal. Click **Roll back** → *crosses a boundary the expert set*; the expert said investigate. This exists only because of the counterfactual.
13. Case **D** (missing data): per-version metrics are missing. Any choice → *Cannot confirm: missing evidence*. SecondShift won't guess.

Extra paths worth showing: choose **Restart service** as the expert (no divergence, no question asked), or click **Try a vague answer** ("it just felt off"): no rule is learned, and the UI says why.

---

## Architecture

One Next.js app (App Router, TypeScript), one page, three server routes, no database.

```
src/domain/            pure TypeScript, no React, fully unit tested
  types.ts             IncidentState, IncidentSignal, Action, ExpectedAction,
                       DecisionDivergence, ExpertExplanation, Citation,
                       CounterfactualQuestion, DecisionRule, Guardrail,
                       Evidence, Confidence, TraineeDecision, EvaluationResult
  signals.ts           telemetry → tri-state signals (present / absent / unknown)
  playbook.ts          runbook → expected action
  divergence.ts        expected vs actual, ignored signals, the "why" question
  extraction.ts        explanation text → citations grounded against telemetry
  rules.ts             rule v1, derived guardrails, confidence from factors
  counterfactual.ts    choose the boundary to probe, read the answer, rule v2
  evaluation.ts        match rule on a new incident, grade the trainee, provenance
  session.ts           the expert flow as pure state transitions (UI uses these)
  scenarios.ts         seeded incidents and scripted fallback answers

src/lib/voice/
  elevenlabs-server.ts server-only: single-use token, TTS
  scribe-client.ts     browser: mic → 16 kHz PCM → Scribe v2 Realtime WebSocket
  tts-client.ts        browser: one audio channel for spoken questions

src/app/api/voice/
  status/route.ts      GET  is a key configured (never returns the key)
  scribe-token/route.ts POST mint a single-use realtime_scribe token
  speak/route.ts       POST text → MP3 via ElevenLabs TTS

src/components/        the incident UI (left: incident, center: decision flow,
                       right: learned rule / provenance)
```

**Where AI is used, and where it isn't.** ElevenLabs does what needs a model: turning speech into text (Scribe v2 Realtime) and asking questions out loud (TTS). Everything that needs an exact, repeatable answer is plain code: deriving signals from telemetry, the runbook prediction, divergence, grounding, rule matching, guardrails and trainee grading. That's deliberate. A trainee verdict has to be explainable and identical every time, and a rule condition has to be checkable on a new incident.

**Grounded extraction.** The explanation is matched against a closed vocabulary of incident signals (with negation handling: "error rate stayed normal" is a claim of *absence*). Each match becomes a citation that records what the expert claimed and what telemetry shows. Only agreements become conditions. Contradicted or unverifiable claims are shown and penalise confidence, but are never learned. If nothing grounds, no rule is produced.

**Counterfactual selection.** Among signals the expert cited, pick one that has an observed-but-uncited sibling of the same kind (error spike ↔ latency). Ask whether the decision survives swapping them. "No" confirms the cited signal as required and adds a guardrail with the expert's alternative action. "Yes" broadens the condition to either signal. If the answer's stance is unclear, the expert picks; nothing is guessed.

**Confidence** is the sum of listed factors (one decision observed, reasons confirmed by telemetry, rejection reason given, counterfactual result, ignored claims), capped at 0.85 because it comes from a single incident. It's labelled as a heuristic in the UI.

---

## How ElevenLabs is used

| Capability | API | Where |
|---|---|---|
| Speech to text, streaming | **Scribe v2 Realtime** (`scribe_v2_realtime`) over `wss://api.elevenlabs.io/v1/speech-to-text/realtime` | Expert answers to "why" and to the counterfactual |
| Browser auth for STT | `POST /v1/single-use-token/realtime_scribe` (server-side, 15-min single-use token) | `/api/voice/scribe-token` |
| Text to speech | `POST /v1/text-to-speech/{voice_id}` with `eleven_flash_v2_5` | SecondShift speaks the divergence question and the counterfactual |

The browser captures the mic with an AudioWorklet, resamples to 16 kHz mono PCM, and sends `input_audio_chunk` messages (`commit_strategy=vad`, `language_code=en`). Partial transcripts render live; on **Stop**, a final chunk with `commit: true` flushes the rest. The expert can correct the transcript before submitting, and the evidence is then tagged *edited by expert*.

**The API key never reaches the browser.** The browser only ever sees a single-use token.

### Enabling live voice

```bash
cp .env.example .env.local
# set ELEVENLABS_API_KEY=... (needs Speech to Text and Text to Speech access)
npm run dev
```

Header shows **Voice: ElevenLabs configured**. `GET /api/voice/status` reports `configured: true` (it never echoes the key). The mic needs a secure context: `localhost` or HTTPS. Optional: `ELEVENLABS_VOICE_ID`, `ELEVENLABS_TTS_MODEL`.

## Fallback behaviour

Without a key, the app is fully demoable and says so:

- Header shows **Voice: fallback mode**. The **Answer by voice** button is disabled with the reason shown.
- Answers can be typed, or filled from the **scripted answer**. Scripted text is tagged *Scripted demo answer · not live* everywhere it appears, including rule evidence and trainee provenance.
- Questions show *Voice output off · text only*.

With a key that fails (invalid, quota, network, timeout), errors come back from the server with ElevenLabs' reason (e.g. *"ElevenLabs token request failed (401): Invalid API key"*) and are shown where they happen. Typing and scripted answers stay available. Nothing is presented as live unless it came from Scribe.

Incident telemetry is seeded fixture data, labelled *Seeded demo incident · not live telemetry*.

---

## Running

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # vitest: domain logic + voice routes + PCM encoding
npm run lint
npm run build && npm start
```

The app needs Node 20.9+. The test runner (Vitest 5) needs Node 22.12+ or 24. Developed on Node 24.

## Tests

58 tests in `tests/`:

- **signals**: derivation for every seeded incident, deploy timing window, unknown when per-version data is missing or only one version runs.
- **expert flow**: runbook prediction, no-divergence silence, ignored-signal naming, grounded extraction (incl. spoken paraphrases), negation, contradicted claims, no rule from vague answers, rule v1 shape and confidence.
- **counterfactual**: picks error-spike vs latency, stance reading, alternative action, "no" adds a guardrail, "yes" broadens, confidence cap.
- **evaluation**: all four transfer cases (applies / guardrail / counterfactual guardrail / uncertain), provenance points back to INC-2041, unknown data never fires a guardrail.
- **session**: the UI's state transitions, retry, unclear stance, stance correction re-applies from v1.
- **voice routes**: 503 without a key, token minted server-side and key never returned, upstream 401 and timeout surface as 502 with a reason, TTS returns audio, input validation.
- **PCM**: 16-bit little-endian encoding, resampling 48 kHz and 44.1 kHz to 16 kHz with no drift.

## Limitations

- **Live voice was not exercised with a real key during development** (none was available). The request shapes were checked against the live endpoints (they return the documented `auth_error` / `401 Invalid API key` for bad credentials), and the browser pipeline was tested end to end with a simulated socket. First real-key run should be checked before presenting.
- Extraction uses a closed signal vocabulary with phrase patterns. It handles common phrasings and paraphrases but will miss reasons outside the vocabulary; it fails safe (no rule, explicit message) rather than guessing.
- One expert, one incident, one rule. No persistence: a page refresh starts over.
- Telemetry is seeded. There is no integration with real monitoring.
- The runbook is a fixed five-step list.

## Future vision

- Pull live signals from the incident tooling teams already use, and trigger the "why" prompt from real actions (a rollback command, a feature-flag flip).
- Accumulate rules across many incidents and experts: confirmations raise confidence past the single-incident cap, contradictions surface where experts disagree.
- Let the trainee ask SecondShift "why not restart?" by voice during their own incident.
- Use an LLM to map out-of-vocabulary explanations onto signals, keeping the same grounding check so nothing ungrounded is learned.
- Same loop beyond SRE: any domain with a playbook and experts who know when to ignore it.
