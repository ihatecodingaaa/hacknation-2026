# Judging Evidence

This document is for judges who want to understand what is technically real, what is innovative, and what is intentionally limited.

## One-sentence product idea

> **SecondShift spots when an experienced worker does something different from the normal company instructions, learns why, learns when that advice stops applying, and preserves the lesson for the next person or AI.**

## Why this matters

Most knowledge tools are good at recording normal work.

SecondShift focuses on the opposite case:

```text
company instructions suggest X
expert chooses Y
```

That disagreement is often where hidden expert judgment lives.

SecondShift uses that moment as the trigger for learning.

It does not ask the expert to explain everything they know.

It asks only when there is evidence that the expert knows something the written process does not.

---

# Technical depth

## 1. Real ElevenLabs voice flow

The deployed app uses:

- ElevenLabs Scribe v2 Realtime for speech to text
- ElevenLabs Text to Speech for asking the questions aloud
- ElevenLabs Agents in text-only mode for proposing meaning from messy spoken answers

The production build has been smoke-tested with the real voice path.

The browser does not receive the main ElevenLabs API key.

For Scribe, the server creates a short-lived token.

Relevant files:

- `src/lib/voice/elevenlabs-server.ts`
- `src/lib/voice/scribe-client.ts`
- `src/lib/reasoning/provider.ts`
- `src/app/api/voice/`
- `src/app/api/reasoning/extract/route.ts`

## 2. The language model cannot directly write company guidance

This is the central trust boundary.

The ElevenLabs Agent may propose:

- observations
- possible causes
- rejected alternatives
- possible interpretation of messy speech

Those proposals are untrusted.

Before any proposed claim becomes learned advice, plain TypeScript code applies four checks.

### Check A: Quote provenance

The supporting words must really exist in the expert transcript.

Implemented through quote tracing in:

- `src/domain/speech.ts`

### Check B: The words must actually support the claim

A real live test found an important failure mode.

Speech recognition produced wording similar to:

> "The video started right after the deployment."

The model proposed:

> "Failure began right after a deploy."

The incident evidence happened to agree with that proposed meaning.

SecondShift now rejects it because the expert's own words do not say that anything failed.

This check uses fixed concept anchors and never looks at the incident evidence.

Implemented in:

- `src/domain/support.ts`

Regression coverage:

- `tests/domain/quote-support.test.ts`

### Check C: The expert must not be hedging

Wording such as:

- maybe
- might
- possibly
- not sure

does not become a learned condition.

Negation is also protected. Quote tracing is not allowed to add, remove or skip a "not".

Relevant coverage:

- `tests/domain/review-regressions.test.ts`

### Check D: Incident evidence must agree

Only after the previous checks does SecondShift compare the claim with the seeded incident data.

Contradicted or unverifiable claims are not learned.

The key principle is:

> **Correct incident data cannot rescue an unsupported expert quote.**

## 3. The AI extractor is deliberately not shown the evidence it will be checked against

The ElevenLabs Agent receives:

- the expert transcript
- the question
- limited story context
- available action names

It does not receive the incident values used later to verify its claims.

This keeps proposal and verification separate.

Relevant code:

- `src/lib/reasoning/prompt.ts`
- `tests/voice/reasoning.test.ts`

## 4. Messy speech is handled without rewriting the evidence

Experts do not speak like clean documentation.

They repeat words, use filler words, cut themselves off and restart sentences.

SecondShift creates a cleaned matching representation for analysis, but evidence shown to the user maps back to the original transcript.

Relevant code:

- `src/domain/speech.ts`
- `src/domain/extraction.ts`

## 5. Learning happens only when the expert disagrees with the normal instruction

If the expert follows the expected action, SecondShift stays quiet.

Nothing is asked and nothing is learned.

This prevents the system from trying to capture every ordinary action.

Relevant code:

- `src/domain/divergence.ts`
- `src/domain/session.ts`

## 6. The follow-up question learns the limit of the advice

After learning why the expert chose differently, SecondShift asks a second question:

> What would change your mind?

The goal is to discover where the original advice stops applying.

For live and typed answers, the system does not immediately update the learned rule.

It first creates a draft interpretation showing:

- the original transcript
- yes or no stance
- detected alternative action
- the exact words supporting that reading
- concerns if the reading is weak

The expert must explicitly confirm or correct it.

A "no" with no alternative action is refused.

Relevant code:

- `src/domain/counterfactual.ts`
- `src/domain/session.ts`
- `tests/domain/counterfactual-gate.test.ts`

## 7. The visual map is computed, not decorative

The Decision Boundary Map shows what happens when a learned reason:

- still holds
- stops being true
- cannot be measured

Each cell is produced by running the real rule on a changed version of the incident.

Before the follow-up, an opposite case may show:

```text
Rule is silent
```

After a confirmed follow-up, the same cell may show:

```text
MOVED IN V2
was: Rule is silent
→ Hold and investigate
```

That movement comes from the real rule state.

Relevant code:

- `src/domain/boundary.ts`
- `src/components/boundary/DecisionBoundaryMap.tsx`
- `tests/domain/boundary.test.ts`

## 8. Missing evidence is treated as unknown

Important facts have three states:

```text
present
absent
unknown
```

Unknown is not treated as false.

This prevents missing data from accidentally activating learned advice.

Relevant code:

- `src/domain/signals.ts`
- `src/domain/evaluation.ts`

## 9. Learned judgment is portable

SecondShift can compile the learned rule into:

```text
secondshift.decision-memory/v1
```

The JSON includes:

- conditions
- expert quotes
- evidence requirements
- confirmed alternatives
- missing-evidence behaviour
- source information
- revision history

A separate interpreter can load that file and apply the same decision logic.

The interpreter reads the JSON, not the original in-memory rule.

Relevant code:

- `src/domain/memory.ts`
- `tests/domain/memory-benchmark.test.ts`

## 10. The benchmark actually runs

The app contains 14 seeded incidents that the expert did not see during the original explanation.

With the scripted story:

| Approach | Correct | Abstained | Incorrect |
|---|---:|---:|---:|
| Company instructions only | 5 / 14 | 0 | 9 |
| + learned memory v1 | 10 / 14 | 1 | 3 |
| + learned memory v2 | 11 / 14 | 1 | 2 |

A version-scope follow-up reaches 12 / 14.

These numbers are:

- computed by the application
- protected by tests
- based on seeded fixtures
- not presented as production accuracy

The remaining misses are visible rather than hidden.

Relevant code:

- `src/domain/benchmark.ts`
- `tests/domain/memory-benchmark.test.ts`

## 11. Voice reliability is deliberately limited and predictable

Transient server-side failures receive one retry.

Examples:

- network error
- timeout
- HTTP 5xx

Errors that should not be blindly retried are not retried.

Examples:

- authentication
- validation
- quota
- rate limit

Relevant code:

- `src/lib/voice/elevenlabs-server.ts`
- `tests/voice/routes.test.ts`

## 12. Engineering hygiene

Current project state:

```text
173 automated tests passing
lint clean
production build passing
```

The project is one typed Next.js application.

No database, queue or large multi-agent framework was added simply to make the architecture look bigger.

---

# Innovation

## 1. The unit of capture is the exception, not the workflow

Many systems capture:

> what happened

SecondShift focuses on:

> why did the expert knowingly do something different from the expected process?

That reduces unnecessary questioning and targets the moments most likely to contain hidden judgment.

## 2. It discovers knowledge nobody knew needed documenting

A normal expert interview requires someone to know what to ask.

SecondShift uses disagreement to discover the question.

```text
Expected action ≠ Expert action
→ Ask why
```

The organisation does not need to know in advance that the lesson exists.

## 3. It learns when the expert's advice stops working

Saving:

> "Roll back"

is not enough.

SecondShift asks what would change the answer.

That can reveal:

```text
Only new version failing
→ Roll back

Every version failing
→ Hold and investigate
```

The second rule may never have been explicitly documented before the system asked.

## 4. It preserves both the advice and its source

SecondShift keeps the expert's own words attached to the learned guidance.

The trainee experience can therefore explain:

> Here is the lesson, and here is where it came from.

rather than:

> The AI says so.

## 5. One lesson can serve both people and software

The same learned judgment can:

- coach a new employee
- be exported as structured memory
- be rendered as context for a future AI agent
- become a future policy check before an automated action

The current prototype does not autonomously act on production systems.

---

# Communication

## Story view

The default interface presents the product as six chapters:

1. Before
2. Surprise
3. Why
4. Boundary
5. Transfer
6. Memory

Each screen focuses on one part of the story.

## Analyst view

`/?view=analyst`

The Analyst view exposes more technical detail for judges who want to inspect:

- incident values
- learned conditions
- evidence
- advice strength
- benchmark cases
- exported memory

## Every important source is labelled

The app distinguishes:

- live ElevenLabs transcript
- typed answer
- scripted fallback
- seeded incident data
- model-based extraction
- deterministic fallback

The project does not present seeded demo data as live production data.

---

# What is intentionally not claimed

SecondShift does not claim:

- production accuracy
- a complete enterprise product
- support for every industry
- fully autonomous production decisions
- that one expert answer should become universal truth
- that 14 seeded benchmark cases prove real-world performance

The prototype is designed to prove the mechanism and make its failure modes visible.

---

# Fast path for judges

If you only have a few minutes:

1. Read the first section of `README.md`
2. Open https://hacknation-2026-eight.vercel.app/
3. Choose **Roll back deployment**
4. Follow **Ask the expert why**
5. Continue to **Probe the boundary**
6. Look for **MOVED IN V2**
7. Open **Memory**
8. Inspect `src/domain/support.ts`, `src/domain/counterfactual.ts`, and `src/domain/memory.ts`
9. Run `npm test` if desired

## Final technical principle

> **The model proposes. Code decides.**

## Final product principle

> **SecondShift does not try to record everything an expert knows. It finds the moments where the expert knows the normal instructions are not enough.**
