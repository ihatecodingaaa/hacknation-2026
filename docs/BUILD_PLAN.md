# Build Plan

## What we are proving

A rule learned from one expert decision on one incident can correctly guide a
trainee on a different incident, and the system can show exactly why.

## Shape

One Next.js app, one page, no database. All judgment logic is deterministic
TypeScript in `src/domain/` so it can be tested and so the trainee verdict is
an exact answer, not a model guess. ElevenLabs handles the voice: Scribe v2
Realtime transcribes the expert, TTS asks the "why" question out loud.

```
src/domain/          pure, tested, no React
  types.ts           IncidentState, IncidentSignal, Action, DecisionDivergence,
                     ExpertExplanation, CounterfactualQuestion, DecisionRule,
                     Guardrail, Evidence, Confidence, TraineeDecision, EvaluationResult
  signals.ts         telemetry -> tri-state signals (present / absent / unknown)
  actions.ts         action catalog
  playbook.ts        expected action ("what the runbook says")
  divergence.ts      expected vs actual, which signals the playbook ignored
  extraction.ts      explanation text -> grounded conditions (with quotes)
  rules.ts           build rule, guardrails, confidence (with visible factors)
  counterfactual.ts  pick the boundary to probe, apply the answer -> rule v2
  evaluation.ts      match a rule against a new incident, grade a trainee
  scenarios.ts       seeded incidents + scripted fallback answers

src/lib/voice/       ElevenLabs browser client (realtime STT over WebSocket)
src/app/api/voice/   server routes: status, single-use Scribe token, TTS proxy
src/components/      the operational UI
```

## Key decisions

- **Signals are derived, not hand-labelled.** Each incident carries telemetry
  (error rates, per-version breakdown, deploy time, error onset). Code derives
  the signal states, so a new incident is evaluated the same way as the source.
- **Tri-state signals.** A signal can be `unknown` (e.g. per-version metrics
  missing). The evaluator refuses to guess and returns an uncertain verdict.
- **Grounded extraction.** The explanation is matched against a closed signal
  vocabulary. A cited signal only becomes a rule condition if the telemetry
  confirms it. Claims the telemetry contradicts are flagged, not learned.
  If nothing grounds, no rule is produced.
- **Counterfactual = boundary probe.** Pick a cited condition and an observed
  but uncited signal of the same kind (errors vs latency). Ask whether the
  decision survives swapping them. "No" confirms the condition as necessary and
  adds a guardrail; "Yes" broadens the condition.
- **Confidence is a sum of visible factors**, capped because one incident is
  one incident. No unexplained numbers.
- **Voice is optional at runtime.** Without `ELEVENLABS_API_KEY` the app runs
  in a labelled fallback mode (typed or scripted answers). Fallback text is
  always tagged with its source and never shown as a live transcript.
- **API key never reaches the browser.** The browser gets a single-use Scribe
  token from `/api/voice/scribe-token`; TTS is proxied by `/api/voice/speak`.

## Demo cases

Expert: INC-2041 checkout-api, bad deploy on a 50% rollout.
Trainee transfer:
- A payments-gateway, different numbers, same pattern -> rule applies
- B edge case: errors on all versions after a deploy -> guardrail blocks rollback
- C latency-only after deploy -> counterfactual guardrail says investigate
- D per-version metrics missing -> uncertain, verify before acting

## Order

1. Domain types + seeded scenarios
2. Signals, playbook, divergence, rule matching, trainee evaluation
3. End-to-end UI on seeded data
4. Extraction + counterfactual layer
5. ElevenLabs STT + TTS behind server routes, fallback preserved
6. Visual polish, tests, lint, build, README, STATUS
