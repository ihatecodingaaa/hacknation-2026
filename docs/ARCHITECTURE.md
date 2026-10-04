# Architecture

One Next.js app (App Router, TypeScript). No database, no queue, no agent framework. Seeded typed data for incidents.

## Layers

```
src/domain/            pure TypeScript, no React, unit tested
  signals.ts           telemetry → tri-state signals (present / absent / unknown)
  playbook.ts          runbook → expected action
  divergence.ts        expected vs actual; the "why" question
  speech.ts            disfluency-tolerant normalization with offset maps; quote tracing
  extraction.ts        phrase matcher (fallback and cross-check)
  semantic.ts          schema for model-proposed claims; deterministic verification
  support.ts           do the expert's words support the claimed signal? (concept anchors, no telemetry)
  rules.ts             rule v1 (conditions only), evidence strength
  counterfactual.ts    choose the boundary to probe; read the answer as a draft; rule v2
  evaluation.ts        match a rule (guardrails first), grade a trainee, provenance
  boundary.ts          Decision Boundary Map data; place an incident on it
  memory.ts            decision memory artifact: compile, validate, execute, render
  benchmark.ts         14 seeded cases, policies, grading
  session.ts           the expert flow as pure state transitions
  scenarios.ts         seeded incidents and scripted fallback answers

src/lib/voice/         ElevenLabs: server calls (token, TTS, retry), browser Scribe client, TTS player
src/lib/reasoning/     semantic provider interface, ElevenLabs Agents provider, prompt builder
src/app/api/           voice/status, voice/scribe-token, voice/speak, reasoning/extract
src/components/        Story view (judge/), Analyst console, boundary map, verification, evaluation
```

## Where models are used, and where they are not

| Step | How |
|---|---|
| Speech → text | ElevenLabs Scribe v2 Realtime |
| Asking the questions | ElevenLabs TTS |
| Proposing claims from messy speech (optional) | ElevenLabs Agents, text-only, behind `SemanticReasoningProvider` |
| Deciding which claims are true | Code: quote tracing, signal vocabulary, hedging, telemetry |
| Rules, counterfactual choice, matching, grading, map, benchmark | Code |

## Trust boundary

The model's output is untrusted input. It is parsed with a strict schema, and every claim must pass four checks before it can become a rule condition: its quote is in the transcript, those words support the claimed signal, it is not hedged, and the telemetry agrees. A transcript that tries to instruct the model can at worst produce claims that still have to be in the transcript, be supported by the words, and agree with the telemetry. The extractor is not given telemetry values.

## Reliability

- No keys: typed and scripted answers, phrase matcher, all labelled.
- Transient ElevenLabs failures (network, timeout, 5xx): one retry on the server. 4xx: no retry, reason shown.
- Semantic extractor failure or timeout (15 s server, 20 s browser): phrase matcher, reason shown.
- Async extraction results are dropped if the session was reset or the action changed while waiting.

## Data handling

API keys are read on the server only. The browser receives a single-use Scribe token. Transcripts are not stored or logged. What each ElevenLabs API receives is listed in the README.
