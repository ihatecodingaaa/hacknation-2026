# Architecture

## Overview

SecondShift is one Next.js application written in TypeScript.

The system is intentionally small.

There is:

- no database
- no queue
- no large agent framework
- no authentication layer
- no billing system

The focus is the learning mechanism.

## Plain-English system flow

```text
Expert makes a decision
        ↓
SecondShift compares it with the normal company instruction
        ↓
If they match, nothing is learned
        ↓
If they differ, SecondShift asks why
        ↓
ElevenLabs Scribe converts the spoken answer to text
        ↓
ElevenLabs Agent proposes possible meaning
        ↓
TypeScript code checks every proposed claim
        ↓
Only supported claims become learned advice
        ↓
SecondShift asks what would change the expert's mind
        ↓
Expert confirms the interpretation
        ↓
The learned advice is updated
        ↓
The rule is tested on new incidents
        ↓
The result can be exported as decision memory
```

## Main folders

```text
src/domain/
  Pure TypeScript decision logic.
  No React.
  Unit tested.

src/lib/voice/
  ElevenLabs voice integration.

src/lib/reasoning/
  ElevenLabs Agent integration.

src/app/api/
  Server endpoints used by the browser.

src/components/
  Story view, Analyst view, verification screens,
  Decision Boundary Map and evaluation UI.
```

## Important domain files

| File | What it does |
|---|---|
| `signals.ts` | Converts raw incident data into facts such as "errors are high" |
| `playbook.ts` | Represents the normal company instruction |
| `divergence.ts` | Detects when the expert chooses something different |
| `speech.ts` | Handles messy spoken language while preserving the original transcript |
| `extraction.ts` | Deterministic fallback for finding useful claims |
| `semantic.ts` | Validates AI-proposed claims |
| `support.ts` | Checks whether the expert's words actually support the proposed meaning |
| `rules.ts` | Builds the learned advice |
| `counterfactual.ts` | Chooses and interprets the "what would change your mind?" question |
| `session.ts` | Controls the learning flow |
| `evaluation.ts` | Applies learned advice to new incidents |
| `boundary.ts` | Builds the visual map of where advice applies or stops applying |
| `memory.ts` | Creates, validates and executes portable decision memory |
| `benchmark.ts` | Runs the 14 seeded evaluation incidents |
| `scenarios.ts` | Holds seeded demo incidents and fallback answers |

## Where AI is used

| Step | Tool |
|---|---|
| Spoken answer to text | ElevenLabs Scribe v2 Realtime |
| Spoken questions | ElevenLabs Text to Speech |
| Proposing possible meaning from messy speech | ElevenLabs Agents, text-only mode |

The language model is only used to propose candidate meaning.

It does not directly create company guidance.

## Where normal code is used

Plain TypeScript code handles:

- deriving facts from incident data
- deciding what the normal company instruction recommends
- detecting disagreement
- verifying expert claims
- checking uncertain wording
- checking whether the expert's own words support the claim
- comparing claims with incident evidence
- choosing the follow-up question
- interpreting the confirmed follow-up
- building learned advice
- deciding whether the advice applies to a new incident
- handling missing evidence
- trainee grading
- building the Decision Boundary Map
- running the benchmark
- creating and executing decision memory

This separation is deliberate.

The core rule is:

> **The model proposes. Code decides.**

## The four checks before a claim can be learned

A candidate claim must pass all four checks.

### Check 1: Was it actually said?

The quoted words must exist in the expert transcript.

The system can tolerate filler words, repeated words and cut-off speech while still mapping the evidence back to the original transcript.

### Check 2: Do the words actually support the meaning?

The expert's own words must independently support the proposed claim.

This check does not look at incident evidence.

For example:

```text
"The video started right after the deployment"
```

cannot support:

```text
"The failure started right after the deployment"
```

even if the incident data happens to show a failure.

### Check 3: Is the expert confident enough?

Hedged wording such as:

```text
maybe
might
not sure
possibly
```

is blocked from becoming a learned condition.

### Check 4: Does the incident evidence agree?

Only after the previous checks does SecondShift compare the claim with the incident data.

Contradicted or unverifiable claims are not learned.

## Why the AI extractor does not receive the incident evidence

The ElevenLabs Agent receives the transcript and limited story context.

It does **not** receive the incident values that will later be used to verify its claims.

This reduces the chance that the model simply shapes its interpretation to fit the known answer.

The verifier checks the AI proposal independently.

## Follow-up safety

The follow-up question is designed to discover where the expert's original advice stops applying.

A live or typed answer does not immediately update the learned rule.

SecondShift first shows:

- the original transcript
- whether it understood the answer as yes or no
- which alternative action it detected
- which words support that interpretation

The expert then chooses:

- **Confirm interpretation**
- or correct it

A "no" answer with no alternative action is not enough to create new guidance.

## Missing data

Important facts use three states:

```text
present
absent
unknown
```

Unknown is not treated as false.

This prevents missing evidence from accidentally triggering learned advice.

## Decision Boundary Map

The map is generated by the actual rule engine.

For each learned reason, SecondShift asks the rule what it would do when that reason:

- still holds
- stops being true
- cannot be measured

The cells are not manually hard-coded for the demo.

If a confirmed follow-up changes a case from:

```text
Rule is silent
```

to:

```text
Hold and investigate
```

the map displays:

```text
MOVED IN V2
was: Rule is silent
→ Hold and investigate
```

## Decision memory

`compileDecisionMemory()` converts the learned rule into:

```text
secondshift.decision-memory/v1
```

The artifact includes:

- learned conditions
- original expert quotes
- evidence requirements
- confirmed alternatives
- missing-evidence policy
- source information
- revision history
- evidence-strength information

`parseDecisionMemory()` validates the file.

`executeDecisionMemory()` applies it without needing the original in-memory rule.

A test checks that the exported memory reproduces the same behaviour across the seeded incidents.

`renderAgentContext()` converts the same memory into plain text that could be supplied to another software agent.

The current prototype does not autonomously take production actions.

## ElevenLabs integration

### Scribe v2 Realtime

The browser records the expert's microphone answer.

The server creates a short-lived token.

The browser uses that token to connect to ElevenLabs Scribe v2 Realtime.

The main ElevenLabs API key never needs to be exposed to the browser.

### Text to Speech

The server sends the question text to ElevenLabs and returns the generated audio.

### ElevenLabs Agents

The reasoning provider opens a text-only ElevenLabs Agent conversation.

The transcript is sent as a user message.

The Agent returns structured candidate meaning.

That output still has to pass SecondShift's deterministic verification.

## Reliability

### Voice retries

Transient failures such as:

- network errors
- timeouts
- HTTP 5xx

receive one retry.

Errors such as:

- authentication failure
- validation failure
- quota failure
- rate limit

are not repeatedly retried.

### Reasoning fallback

If the ElevenLabs Agent call fails or times out, SecondShift falls back to a deterministic phrase matcher.

The interface shows which path was used.

### No key

Without ElevenLabs keys, the application still works using typed and scripted fallback answers.

Those answers are clearly labelled as non-live.

## Data handling

- API keys remain on the server
- the browser receives only a short-lived Scribe token
- transcripts are not stored in a database
- this prototype has no persistence
- the ElevenLabs Agent does not receive the incident evidence used to verify its output

## Test coverage

Current project checks:

```text
173 automated tests passing
lint clean
production build passing
```

Tests cover:

- normal instruction selection
- disagreement detection
- speech cleanup
- quote tracing
- negation
- uncertain language
- unsupported quote rejection
- semantic claim verification
- follow-up confirmation
- rule updates
- missing evidence
- Decision Boundary Map behaviour
- trainee evaluation
- decision memory
- benchmark scoring
- ElevenLabs API routes
- retry logic
- API-key protection

## Design goal

The architecture is built around one safety principle:

> **It is better for SecondShift to say "I cannot verify that" than to preserve the wrong expert lesson.**
