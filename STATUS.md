# Status

Last updated: 2026-10-05

## Final hackathon state

SecondShift is complete, deployed, public, and feature-frozen for the Hack-Nation 2026 ElevenLabs challenge.

- **Live product:** https://hacknation-2026-eight.vercel.app/
- **Main branch:** final submission build plus documentation updates
- **Public GitHub:** judges can open the repository without signing in
- **Production smoke test:** passed
- **Automated tests:** 173 passing
- **Lint:** clean
- **Production build:** passing

The full product flow works end to end:

```text
company instructions suggest an action
        ↓
expert chooses something different
        ↓
SecondShift asks why
        ↓
ElevenLabs captures the spoken explanation
        ↓
AI proposes possible meanings
        ↓
code verifies the expert's words and the incident evidence
        ↓
supported reasons become learned advice
        ↓
SecondShift asks what would change the expert's mind
        ↓
expert confirms the interpretation
        ↓
the learned advice becomes more precise
        ↓
a new employee is tested on unseen incidents
        ↓
the lesson is exported as structured decision memory
```

## What has been verified live

The deployed application has been smoke-tested with the real production build.

Verified:

- Story view loads correctly
- ElevenLabs voice mode is active
- ElevenLabs Agent claim extraction is active
- text-to-speech asks the questions
- microphone capture works
- Scribe v2 Realtime produces a live transcript
- AI-proposed claims are checked before learning
- unsupported language can be rejected
- live follow-up answers wait for explicit confirmation
- the learned rule changes only after confirmation
- the Decision Boundary Map shows the real v1 to v2 movement
- the final state can show:
  - `MOVED IN V2`
  - `was: Rule is silent`
  - `Hold and investigate`

## Core behaviour

### 1. Detect a useful exception

If the expert follows the normal company instruction, SecondShift does not ask anything and does not learn anything.

If the expert chooses something different, SecondShift treats that as a potentially valuable moment and asks why.

### 2. Capture the explanation

ElevenLabs Scribe v2 Realtime converts the expert's spoken answer into text.

The original transcript is preserved as the evidence source.

### 3. Verify before learning

A language model may propose what the expert meant, but it cannot directly create company guidance.

Every proposed claim must pass four checks:

1. the quoted words really appear in the transcript
2. the expert's words actually support the proposed meaning
3. the expert is not hedging or expressing low confidence
4. the incident evidence agrees

Only supported claims become learned conditions.

### 4. Ask what would change the decision

SecondShift then asks a follow-up question designed to find the limit of the expert's advice.

For live and typed answers, SecondShift shows its interpretation first.

The expert must confirm or correct it before the learned rule changes.

A simple "no" with no alternative action is not allowed to silently create new guidance.

### 5. Transfer the lesson

The learned advice is applied to incidents the original expert did not see.

SecondShift can:

- support the expert action
- leave the normal company instruction in place
- apply a confirmed alternative
- abstain when evidence is missing

### 6. Export the lesson

The final learned judgment can be exported as `secondshift.decision-memory/v1`.

The JSON contains the learned conditions, original expert words, evidence requirements, confirmed alternatives, missing-evidence behaviour, source information, and revision history.

## Real issue found during testing

A live microphone test exposed an important failure mode.

Scribe misheard wording similar to:

> "The video started right after the deployment."

The AI proposed:

> "Failure began right after a deploy."

The incident data really did show a failure after the deployment.

An earlier version could therefore accept the claim even though the expert's actual words did not support it.

That was fixed.

SecondShift now checks the language independently from the incident data.

So:

> "The video started right after the deployment."

is rejected for a failure-timing claim.

But:

> "The failures started right after the deployment."

can pass.

This is covered by automated tests.

## Current benchmark

The app contains 14 seeded incidents the expert never saw.

With the scripted story:

| Approach | Correct | Abstained | Incorrect |
|---|---:|---:|---:|
| Company instructions only | 5 / 14 | 0 | 9 |
| + learned memory before the follow-up | 10 / 14 | 1 | 3 |
| + learned memory after the follow-up | 11 / 14 | 1 | 2 |

A story where the follow-up tests version scope reaches 12 / 14.

These are seeded test fixtures, not production accuracy claims.

## What is live

With the production configuration:

- microphone capture
- ElevenLabs Scribe v2 Realtime
- ElevenLabs text-to-speech
- ElevenLabs Agent candidate extraction
- all verification logic
- learned advice
- follow-up confirmation
- trainee grading
- Decision Boundary Map
- benchmark execution
- decision-memory generation

## What is seeded

- incident data used by the story
- trainee incidents
- fourteen benchmark incidents
- scripted fallback answers
- benchmark ground-truth labels

Seeded and scripted data are labelled in the interface.

## Known limitations

This is a hackathon prototype.

- no long-term database or organisation accounts
- refresh resets the current session
- one main expert-learning scenario
- one expert at a time
- incident data is seeded rather than connected to production monitoring
- deterministic language support is tuned to seven signals used by the current software-operations demo
- fourteen benchmark cases are useful mechanism tests, not a real-world performance study
- follow-up interpretation uses deliberately simple deterministic rules and therefore requires expert confirmation
- no autonomous production agent takes actions from the learned memory

## Code quality

Final checks:

```text
npm test       → 173 tests passing
npm run lint   → clean
npm run build  → passing
```

The project is intentionally one Next.js TypeScript application with no database, no queue, and no large agent framework.

## Recommended judge path

1. Read the first section of [README.md](README.md)
2. Open the [live product](https://hacknation-2026-eight.vercel.app/)
3. Use Story view for the six-step product story
4. Read [docs/JUDGING.md](docs/JUDGING.md) for technical evidence
5. Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the system design
6. Read [docs/DEMO.md](docs/DEMO.md) for the 60-second product and technical walkthroughs

## Final product thesis

> **Most systems record what experts do. SecondShift finds the moments where experts know the normal instructions are not enough, learns why, and preserves that judgment for the next person or AI.**
