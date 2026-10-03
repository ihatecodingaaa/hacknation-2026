# Status

Last updated: 2026-10-04

## Current state

The full demo works end to end in fallback mode (no API key): expert divergence → why → grounded rule v1 → counterfactual → rule v2 → trainee transfer on four cases with provenance.

The ElevenLabs integration (Scribe v2 Realtime STT + TTS) is implemented behind server routes. It has **not** been run with a real API key, because none was available.

## Works

- App boots (`npm run dev`, `npm run build && npm start`). Single page at `/`.
- Expert shift on INC-2041: runbook expectation, expert action, divergence with ignored signals, "why" question.
- No-divergence path: choosing the runbook action asks nothing and learns nothing.
- Explanation capture: typed, scripted (labelled "not live"), or live voice (needs key).
- Grounded extraction with highlighted phrases and a claim-vs-telemetry table.
- Ungrounded/vague answer: no rule, explicit message, retry.
- Rule v1 with derived guardrails, evidence and confidence factors.
- Counterfactual question chosen from the rule (error spike vs latency), rationale and hypothetical diff.
- Stance reading of the answer, manual pick if unclear, "Misread? Flip it" correction.
- Rule v2 with "boundary tested" condition, counterfactual guardrail, version history, highlighted changes.
- Trainee transfer: A mismatch (restart vs rollback), B guardrail blocks rollback, C counterfactual guardrail says investigate, D uncertain (missing per-version data).
- Provenance: verdicts trace back to the expert's quote, INC-2041 telemetry and the counterfactual Q/A, each with a source tag.
- Fallback mode is clearly labelled everywhere (header, voice button, question audio status, evidence tags).
- Voice failure handling verified in the browser with an invalid key: TTS failure shows "ElevenLabs TTS failed · text only"; token failure shows "ElevenLabs token request failed (401): Invalid API key"; the real Scribe WebSocket `auth_error` is shown and the UI recovers.
- Browser mic → PCM → WebSocket pipeline verified with a synthetic mic and a simulated socket: chunks at 16 kHz, live partials, commit on stop, final transcript, "ElevenLabs Scribe · live" tag carried into rule evidence.
- Layout: three panes from 1024px wide, stacked below that, no horizontal scroll at phone width.

## Not verified / does not work

- Live ElevenLabs STT and TTS with a valid key. Request shapes match the official docs and the live endpoints respond as documented to bad credentials, but a successful real session has not been observed.
- Mic capture on a real microphone (tested with a synthetic stream only).

## Known defects / limitations

- Extraction is a closed vocabulary of 7 signals with phrase patterns. Reasons outside it are not learned (fails safe with a message).
- No persistence: refreshing the page resets the session.
- Telemetry is seeded fixture data (labelled in the UI).
- In browser automation the first click right after a page navigation was sometimes ignored (focus); not reproduced by hand.
- `npm audit` reports 5 high advisories in dev-only ESLint tooling (`braces` via `eslint-config-next`). The suggested fix downgrades `eslint-config-next` to 14, so it was left alone.

## Tests run

- `npm test`: 7 files, 58 tests, all passing (domain logic, session transitions, voice routes, PCM encoding).
- `npm run lint`: clean.
- `npm run build`: passes. Routes: `/` (dynamic), `/api/voice/status`, `/api/voice/scribe-token`, `/api/voice/speak`.
- Manual browser run of every path listed under "Works" against the production build.
- Scripted browser run under `next dev`: all 12 trainee case/action verdicts as expected, no React warnings or console errors. (This run caught and fixed a duplicate-key bug that stacked stale panes when switching modes.)

## Next task

1. Put a real `ELEVENLABS_API_KEY` in `.env.local`, run `npm run dev`, and do one full voice run: speak the explanation and the counterfactual answer. Check the transcript, then check the rule evidence shows "ElevenLabs Scribe v2 Realtime · live".
2. Deploy (e.g. Vercel) with `ELEVENLABS_API_KEY` set as a server environment variable. The mic needs HTTPS.
3. Rehearse the walkthrough in README.md.
