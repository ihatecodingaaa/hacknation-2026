# SecondShift

> **The company instructions say one thing. The expert does something else. SecondShift learns why.**

SecondShift is a system for capturing the useful judgment that experienced workers carry in their heads but never wrote down.

A company might have instructions that say:

> If the service is failing, restart it.

But an experienced engineer might look at the same problem and say:

> Do not restart it. Roll back the latest software version.

That difference is valuable. The expert noticed something the written instructions did not.

SecondShift finds moments like this, asks the expert why they chose differently, checks whether the explanation is actually supported by the available evidence, asks what would make the expert change their mind, and saves the result so another person or software system can use it later.

**Built solo by Lucas Tan for Hack-Nation 2026, ElevenLabs challenge: The AI Apprentice.**

**Live demo:** https://hacknation-2026-eight.vercel.app/

---

## The 30-second explanation

Most companies already document their normal procedures.

The harder problem is that experienced workers often know when those procedures should **not** be followed.

That knowledge is usually not written down.

It may disappear when the employee retires, resigns, changes teams, goes on leave, or simply is not available when somebody else needs help.

SecondShift focuses on those moments.

It does not ask an expert to explain everything they know.

Instead, it waits for a useful signal:

1. The company instructions suggest one action.
2. The expert chooses something different.
3. SecondShift asks: **Why?**
4. It checks whether the explanation is supported.
5. It asks: **What would make you choose differently?**
6. It saves both the advice and the limit of that advice.

The goal is simple:

> **An expert should only need to explain an important lesson once. The organisation should be able to remember it.**

---

# Why this exists

## The problem

Companies are full of written instructions, checklists, procedures, manuals and training material.

Those documents are useful, but they mostly describe what should happen in normal situations.

Experienced workers build something else over time: judgment.

They learn things like:

- when the normal procedure is unsafe
- when two problems that look similar are actually different
- which warning signs matter
- which warning signs can be ignored
- when to stop and investigate instead of acting
- when an exception is safe
- when the same exception becomes dangerous

This knowledge is often learned through years of mistakes, incidents and repeated exposure.

It is difficult to document because the expert may not even realise that the knowledge is unusual.

To them, it simply feels obvious.

That creates a problem:

```text
New employee gets stuck
        ↓
Asks experienced employee
        ↓
Experienced employee stops their own work
        ↓
Explains the exception
        ↓
Problem is solved
        ↓
Months later
        ↓
Another employee asks the same question
```

SecondShift tries to change this into:

```text
Experienced employee explains the important exception once
        ↓
SecondShift checks and preserves it
        ↓
The next employee can reuse the lesson
```

---

# What makes SecondShift different

## It learns exceptions, not just instructions

A normal workflow recording tool might record:

> The engineer rolled back the deployment.

That is useful, but incomplete.

SecondShift wants to know:

> Why did the engineer roll back instead of following the normal restart instruction?

And then:

> What would have made the engineer decide **not** to roll back?

Those two questions reveal much more than a recording of the original action.

They reveal the expert's reasoning and, just as importantly, the limit of that reasoning.

---

## It discovers knowledge nobody knew needed documenting

A normal expert interview depends on someone knowing what questions to ask.

For example:

> "Sarah is retiring. Let's interview her about everything she knows."

The problem is that Sarah may not know which parts of her experience are unusual.

SecondShift uses disagreement as the trigger.

```text
Company expected X
        ↓
Expert chose Y
        ↓
Something interesting probably happened
        ↓
Ask why at that exact moment
```

This means SecondShift can discover a useful lesson without a manager having to know that the lesson existed beforehand.

---

## It learns when advice stops working

Suppose an expert says:

> "I rolled back because only the new version was failing."

A simple system could save:

```text
Only new version failing → Roll back
```

SecondShift goes one step further.

It asks something like:

> "If every version were failing, would you still roll back?"

The expert might answer:

> "No. Then I would hold and investigate."

Now the organisation knows both sides:

```text
Only the new version is failing
→ Roll back

Every version is failing
→ Hold and investigate
```

This is one of the central ideas behind SecondShift.

It does not only save what the expert did.

It tries to learn **when that advice should be copied and when it should not be copied.**

---

# The demo scenario

The current prototype demonstrates the idea using a software operations incident.

This is only the demonstration environment. SecondShift is not meant to be limited to software engineers.

## What happens

A service called `checkout-api` starts returning many errors.

The company's normal instructions say:

> **Restart the service.**

An experienced engineer chooses:

> **Roll back the latest deployment.**

SecondShift notices that the expert did something different.

That disagreement is the moment it decides to learn.

### Step 1: The normal instruction

SecondShift first determines the action the written instructions would suggest.

For the demo:

```text
High error rate
→ Restart service
```

### Step 2: The expert disagrees

The expert chooses:

```text
Roll back deployment
```

SecondShift now knows there may be useful hidden judgment here.

### Step 3: SecondShift asks why

Using ElevenLabs voice, SecondShift asks the expert why they chose rollback.

A clear answer might be:

> "The failures started right after the deployment, and only the new version is affected. Restarting would just restart the bad version."

ElevenLabs Scribe v2 Realtime converts the spoken answer into text.

### Step 4: SecondShift checks the explanation

SecondShift does **not** immediately turn the AI's interpretation into a company rule.

That is deliberate.

The system checks every proposed reason before learning it.

For example:

```text
Expert says:
"The failures started right after the deployment."

System evidence:
The failure spike did begin immediately after the deployment.

Result:
SUPPORTED
```

But if the speech recognition produces something like:

```text
"The video started right after the deployment."
```

and the AI guesses that the expert meant:

```text
"The failure started right after the deployment."
```

SecondShift rejects it.

Even if the system data happens to show a failure after the deployment, the expert's actual words did not say that.

The result is shown as:

```text
REJECTED: QUOTE DOES NOT SUPPORT CLAIM
```

This is intentional.

**The model proposes. Code decides.**

### Step 5: SecondShift asks what would change the expert's mind

After learning the expert's first explanation, SecondShift asks a follow-up question.

For example:

> "If the failures were not isolated to the new version, would you still roll back?"

The expert might answer:

> "No. I would hold and investigate instead."

For live or typed answers, SecondShift shows what it thinks the expert meant and waits for the expert to confirm it.

Nothing changes until the expert clicks **Confirm interpretation**.

### Step 6: The learned advice becomes more precise

Before the follow-up question, SecondShift may know:

```text
Only new version failing
→ Roll back
```

but have no learned advice for:

```text
Every version failing
→ ?
```

After the confirmed follow-up, it can learn:

```text
Every version failing
→ Hold and investigate
```

The interface visibly shows the change as:

```text
MOVED IN V2
was: Rule is silent
→ Hold and investigate
```

That movement is computed from the actual rule. It is not a decorative animation.

### Step 7: Teach another employee

SecondShift then tests the learned advice on different incidents that the expert did not see during the original explanation.

If a trainee makes a decision that conflicts with the learned expert guidance, SecondShift can show:

- what it recommends
- why
- which part of the expert's explanation supports it
- what evidence is present
- when the advice does not apply
- when the system does not know enough and should abstain

### Step 8: Save the lesson

The final result can be exported as structured decision memory.

In simple terms, this is a machine-readable record containing:

- what happened
- what the normal instruction suggested
- what the expert did instead
- why the expert did it
- the expert's original words
- what evidence supported the explanation
- what would change the decision
- what action should happen in that different situation
- what to do when evidence is missing
- how the advice changed over time

The same memory can be used to teach a human trainee or converted into context for a future software agent.

SecondShift does **not** autonomously operate production systems in this prototype.

---

# Who could use this?

The prototype uses software incident response because it is easy to demonstrate clearly.

The underlying idea is broader.

SecondShift is useful anywhere there are:

1. written procedures
2. experienced people
3. recurring exceptions
4. costly mistakes
5. evidence that can help check what happened

Possible future use cases include:

### Software operations

Instructions say restart.

Experienced engineer recognises that only the new version is broken and rolls back instead.

SecondShift captures why.

### Cybersecurity

Security instructions suggest blocking an account.

An experienced analyst recognises that the behaviour is legitimate in this particular situation.

SecondShift captures the exception and the warning signs that matter.

### Fraud operations

A transaction looks suspicious according to a normal rule.

A senior investigator recognises a legitimate pattern that a junior might miss.

SecondShift preserves the reasoning.

### Insurance claims

A normal process suggests escalation.

An experienced claims worker recognises a known exception.

SecondShift records when the exception applies and when it does not.

### Industrial maintenance

A manual says restart a machine.

A technician notices a vibration pattern that suggests restarting could make the problem worse.

SecondShift asks why and preserves the lesson.

### Customer support

A script says refund.

An experienced support agent recognises that a different action will solve this particular problem better.

SecondShift captures the reasoning instead of just recording the final click.

### Financial operations

A normal process says stop or escalate a payment.

An experienced operator recognises a reconciliation exception.

SecondShift captures the evidence behind the decision.

---

# How this could save a company money

SecondShift is not designed around a single savings claim, and this hackathon prototype does not estimate production ROI.

The possible economic value comes from several places.

## Faster problem solving

If an experienced employee has already solved a similar unusual problem, the next worker should not have to rediscover the lesson from zero.

In expensive environments, even a small reduction in downtime or investigation time can matter.

## Fewer interruptions to senior staff

Many organisations repeatedly ask the same experienced employees for help.

If a useful exception is explained once and preserved, the next employee may not need to interrupt the expert again.

## Faster training

New employees can learn not only the official procedure, but also the situations where experienced workers know the official procedure is not enough.

## Less knowledge lost through turnover

When an employee retires, resigns or changes teams, the written documentation usually stays.

Their judgment usually does not.

SecondShift is designed to preserve more of that judgment before it disappears.

## Safer future AI agents

Enterprise AI systems are often given documents, procedures and knowledge bases.

Those sources explain what is supposed to happen.

They may not contain the exceptions experienced humans rely on.

SecondShift's long-term direction is to provide verified human decision memory that can help a future AI system understand both:

- what the normal instruction says
- when experienced humans know not to follow it blindly

---

# Why voice?

Voice is not the product.

The product is the captured judgment.

Voice is useful because the system asks a short question at the moment an unusual expert decision happens.

Instead of asking the worker to stop and write a report, SecondShift can ask:

> "What made you choose that?"

The expert can answer naturally while the reasoning is still fresh.

For a real product, the same system could support other input methods such as typing, Slack, Teams or a quick annotation.

For this hackathon, voice is implemented through ElevenLabs because the challenge focuses on a voice-powered AI apprentice.

---

# ElevenLabs integration

SecondShift uses three ElevenLabs capabilities.

| Capability | What SecondShift uses it for |
|---|---|
| **Scribe v2 Realtime** | Converts the expert's spoken answer into text |
| **ElevenLabs Text to Speech** | Speaks the questions SecondShift asks |
| **ElevenLabs Agents, text-only mode** | Proposes possible meaning from messy natural speech |

The live flow has been tested with a real ElevenLabs key, a real microphone and the deployed application.

The browser never receives the main ElevenLabs API key.

For Scribe, the server creates a short-lived token for the browser.

---

# How the system works, in plain English

```text
1. Company instructions suggest an action
                ↓
2. Expert chooses something different
                ↓
3. SecondShift asks "Why?"
                ↓
4. ElevenLabs turns the spoken answer into text
                ↓
5. AI proposes what the expert may have meant
                ↓
6. Code checks each proposed reason
                ↓
7. Only supported reasons are learned
                ↓
8. SecondShift asks "What would change your mind?"
                ↓
9. Expert confirms SecondShift understood correctly
                ↓
10. Advice becomes more precise
                ↓
11. Another employee can be coached using the lesson
                ↓
12. The lesson can be exported as structured memory
```

---

# The four checks before SecondShift learns a claim

One of the main technical design decisions is that a language model is not trusted to directly create company guidance.

The AI may **propose** an interpretation.

Plain TypeScript code decides whether it can be learned.

Every proposed claim must pass four checks.

## 1. Did the expert actually say those words?

The quoted evidence must be traceable to the original transcript.

The system is tolerant of normal speech problems such as filler words, repeated words and cut-off phrases.

But the evidence shown to the user still points back to the original transcript.

## 2. Do the expert's words actually support the claim?

This is separate from checking whether the real-world data agrees.

For example:

> "The video started after the deployment"

does **not** support:

> "The failure started after the deployment"

Even if the system evidence shows a real failure after the deployment.

This prevents the AI from using correct system data to rescue an incorrect interpretation of the expert's words.

## 3. Was the expert uncertain?

Statements such as:

> "Maybe it was the deployment"

should not be treated like:

> "The failure started after the deployment."

SecondShift blocks uncertain or hedged claims from becoming learned conditions.

## 4. Does the available evidence agree?

Only after the previous checks does SecondShift compare the claim with the incident data.

If the evidence contradicts the claim, it is not learned.

If the required evidence is missing, SecondShift can leave the answer unknown rather than guessing.

---

# A real failure case that improved the system

During live microphone testing, speech recognition misheard part of an explanation.

The transcript contained wording similar to:

> "The video started right after the deployment."

The AI proposed:

> "Failure began right after a deploy."

The system evidence happened to support that proposed failure timing.

An earlier version of SecondShift could therefore accept the claim even though the expert's actual words did not support it.

That was fixed.

SecondShift now has a separate check that looks only at the expert's words before considering system evidence.

The bad interpretation is rejected as:

```text
QUOTE DOES NOT SUPPORT CLAIM
```

This behaviour is covered by automated tests.

It is an important example of the product's philosophy:

> **It is better to say "I cannot verify that" than to preserve the wrong lesson.**

---

# Human confirmation before changing advice

Voice recognition is imperfect.

A short answer like:

> "No, I would investigate."

can also be misunderstood if the transcription is noisy.

For this reason, live and typed follow-up answers do not immediately change the learned rule.

SecondShift shows:

- the original transcript
- whether it understood the answer as yes or no
- the alternative action it detected
- the exact words supporting that interpretation

The expert must then click:

**Confirm interpretation**

or correct it.

A "no" answer without a clear alternative action is not allowed to update the advice.

---

# Missing information is not guessed

SecondShift represents important facts in three states:

```text
present
absent
unknown
```

If the system does not have enough information to know whether something is true, it stays **unknown**.

That matters because an unknown value should not accidentally trigger an expert rule.

In the trainee demonstration, there is a case where per-version evidence is missing.

SecondShift does not pretend it knows enough.

It abstains.

---

# Decision Boundary Map

The interface contains a visual map showing when the expert's advice applies.

Despite the name, the idea is simple.

For every reason the expert gave, SecondShift asks:

```text
What happens if this reason is true?
What happens if this reason stops being true?
What happens if we cannot measure it?
```

The cells are calculated by running the real rule on those changed conditions.

They are not manually drawn for the demo.

Before a follow-up question, the system may have no learned answer for the opposite situation.

That is shown as:

```text
Rule is silent
```

After the expert confirms the follow-up answer, that cell may visibly change to:

```text
MOVED IN V2
was: Rule is silent
→ Hold and investigate
```

This gives a visible demonstration that the follow-up question actually changed what the system knows.

---

# Testing the lesson on new incidents

The **Transfer** part of the demo gives a trainee new incidents that the original expert did not see.

The system checks whether the learned advice applies.

Different examples demonstrate different behaviours:

- the expert's advice clearly applies
- the normal company instruction applies instead
- the expert explicitly defined a different action
- important evidence is missing, so SecondShift refuses to claim certainty

When SecondShift gives feedback, it can point back to the expert's original words.

The goal is not:

> "The AI says so."

The goal is:

> "Here is the lesson, here is where it came from, and here is why it applies."

---

# Seeded benchmark

The app contains 14 hand-built test incidents.

These are deliberately different from the incident used to teach the original rule.

They include examples such as:

- a clean bad deployment
- CPU overload
- noisy baseline errors
- a failure that starts too late to fit the expert's timing rule
- an upstream outage
- high latency without high errors
- a database problem
- a traffic surge
- missing per-version information
- a full rollout
- a normal case where the original company instruction is appropriate

The benchmark compares three stages.

| Approach | Correct | Abstained | Incorrect |
|---|---:|---:|---:|
| Company instructions only | 5 / 14 | 0 | 9 |
| + expert memory before the follow-up question | 10 / 14 | 1 | 3 |
| + expert memory after the follow-up question | 11 / 14 | 1 | 2 |

For a version of the story where the follow-up question tests version scope, the final score reaches 12 / 14.

These are **seeded test cases**, not production accuracy claims.

The numbers are calculated by the app and protected by tests.

The remaining mistakes are intentionally visible rather than hidden.

---

# What "decision memory" means

The app uses the term **decision memory** for the saved lesson.

It is simply a structured record of an expert decision.

A memory contains information such as:

- the action the expert chose
- the conditions that supported that choice
- the expert's original words
- the evidence required
- situations where the advice should not be used
- what to do if important evidence is missing
- the history of how the advice changed
- where the evidence came from

SecondShift exports this as versioned JSON using the schema:

`secondshift.decision-memory/v1`

Another part of the program can load only that JSON file and apply the same learned rule.

A test checks that the exported memory reproduces the rule engine across the seeded incidents.

The app can also render the memory as plain text suitable for use as context or a policy check for a future AI agent.

No autonomous production agent is included in this prototype.

---

# What is real and what is simulated

Transparency matters, especially in a hackathon demo.

## Live

With ElevenLabs configured:

- microphone capture
- ElevenLabs Scribe v2 Realtime transcription
- ElevenLabs text-to-speech questions
- ElevenLabs Agent candidate extraction
- verification of claims
- learned rule creation
- follow-up question logic
- expert confirmation
- advice updates
- trainee grading
- Decision Boundary Map
- benchmark scoring
- decision memory generation

## Seeded for the demo

- the incident data
- five story scenarios
- the fourteen benchmark incidents
- scripted fallback answers
- benchmark ground-truth labels

The interface labels seeded and scripted information instead of pretending it is live production data.

---

# What happens when ElevenLabs is unavailable?

The demo is designed to remain understandable even if an external API has a temporary problem.

## No ElevenLabs API key

The app still works using typed or scripted answers.

Scripted answers are visibly labelled:

```text
Scripted demo answer · not live
```

## No ElevenLabs reasoning agent

SecondShift uses a deterministic phrase matcher instead.

The interface says which extractor was used.

## Temporary voice failure

Transient network, timeout and server errors receive one retry.

Authentication, quota, rate-limit and validation errors are not repeatedly retried.

The failure reason is shown and the user can continue using text.

## AI extraction failure

The system falls back to the phrase matcher and displays the reason.

---

# Reliability and safety choices

SecondShift deliberately prefers refusing to learn over learning unsupported advice.

Important choices include:

- AI output is treated as untrusted input
- expert quotes must come from the original transcript
- expert words must independently support the proposed meaning
- uncertain language is blocked
- system evidence must agree
- missing evidence stays unknown
- live follow-up answers require expert confirmation
- a "no" answer with no alternative action cannot silently create a new rule
- seeded data and fallback content are labelled
- evidence strength is shown as a heuristic, not as a probability
- the AI extractor does not receive the incident evidence it will later be checked against

---

# Architecture

SecondShift is intentionally a small system.

It is one Next.js application written in TypeScript.

There is:

- no database
- no queue
- no large agent framework
- no authentication system
- no billing system

The focus is the learning mechanism, not application plumbing.

```text
Browser
  │
  ├─ Story interface
  ├─ microphone
  └─ trainee / memory views
        │
        ▼
Next.js server
  │
  ├─ ElevenLabs token endpoint
  ├─ ElevenLabs text-to-speech
  └─ ElevenLabs Agent connection
        │
        ▼
Pure TypeScript decision logic
  │
  ├─ derive facts from incident data
  ├─ determine normal company action
  ├─ detect expert disagreement
  ├─ verify proposed explanations
  ├─ build learned advice
  ├─ choose follow-up question
  ├─ require expert confirmation
  ├─ evaluate new incidents
  ├─ build the visual map
  ├─ run the benchmark
  └─ export decision memory
```

---

# Where the important code lives

You do not need to understand the entire repository to inspect the core idea.

| File | Plain-English purpose |
|---|---|
| `src/domain/signals.ts` | Turns raw incident numbers into facts such as "errors are high" |
| `src/domain/playbook.ts` | Represents the normal company instruction |
| `src/domain/divergence.ts` | Detects when the expert does something different |
| `src/domain/speech.ts` | Handles messy speech while preserving the original words |
| `src/domain/extraction.ts` | Deterministic fallback for finding useful statements |
| `src/domain/semantic.ts` | Handles AI-proposed meanings and verification |
| `src/domain/support.ts` | Checks whether the expert's words actually support a proposed claim |
| `src/domain/rules.ts` | Builds the learned advice |
| `src/domain/counterfactual.ts` | Chooses and interprets the "what would change your mind?" question |
| `src/domain/session.ts` | Controls the expert learning flow |
| `src/domain/evaluation.ts` | Applies learned advice to new incidents |
| `src/domain/boundary.ts` | Builds the visual "when does this advice stop working?" map |
| `src/domain/memory.ts` | Creates and reads portable decision memory |
| `src/domain/benchmark.ts` | Runs the 14 seeded evaluation cases |
| `src/lib/voice/` | ElevenLabs voice integration |
| `src/lib/reasoning/` | ElevenLabs Agent integration |
| `src/components/judge/JudgeView.tsx` | Six-step Story view used for the main demo |

More detailed engineering notes are in:

- [Architecture](docs/ARCHITECTURE.md)
- [Judging evidence](docs/JUDGING.md)
- [Demo script](docs/DEMO.md)
- [Current status](STATUS.md)

---

# Two ways to view the app

## Story view

Open:

https://hacknation-2026-eight.vercel.app/

This is the recommended first-time experience.

It walks through six chapters:

1. **Before**: what happened and what the normal instructions suggest
2. **Surprise**: the expert chooses something different
3. **Why**: SecondShift asks for the expert's reasoning
4. **Boundary**: SecondShift asks what would change the expert's mind
5. **Transfer**: another employee faces a new incident
6. **Memory**: the lesson is saved and tested

## Analyst view

Add:

`/?view=analyst`

This shows a denser technical console with more detail about:

- incident data
- learned conditions
- evidence
- advice strength
- benchmark cases
- exported memory

Story view is for understanding the product.

Analyst view is for inspecting the mechanics.

---

# Running SecondShift locally

## Requirements

- Node.js 20.9+ for the app
- Node.js 22.12+ recommended for the test runner

## Install

```bash
git clone https://github.com/ihatecodingaaa/hacknation-2026.git
cd hacknation-2026
npm install
```

## Start without API keys

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

The app remains demoable using labelled typed and scripted fallbacks.

## Add live ElevenLabs voice

Copy the example environment file:

```bash
cp .env.example .env.local
```

Add:

```text
ELEVENLABS_API_KEY=your_key_here
```

Never commit `.env.local`.

## Add ElevenLabs Agent extraction

Create the text-only reasoning agent:

```bash
npm run setup:reasoning-agent
```

The script prints an agent ID.

Add it to `.env.local`:

```text
ELEVENLABS_REASONING_AGENT_ID=your_agent_id_here
```

Restart the app.

Optional environment variables are documented in [`.env.example`](.env.example).

The microphone requires either `localhost` or HTTPS.

---

# Tests

Run:

```bash
npm test
npm run lint
npm run build
```

Current state:

```text
173 automated tests passing
lint clean
production build passing
```

Tests cover:

- normal company instruction selection
- disagreement detection
- messy voice transcripts
- quote tracing
- semantic claim verification
- the "quote does not support claim" safety check
- negation
- uncertain language
- follow-up confirmation
- guardrails
- missing evidence
- Decision Boundary Map behaviour
- trainee grading
- decision memory
- benchmark scoring
- ElevenLabs routes
- retry behaviour
- protection against exposing the server API key

---

# Data and privacy in this prototype

- The ElevenLabs API key stays on the server.
- The browser receives only a short-lived Scribe token.
- Microphone audio is sent to ElevenLabs Scribe for transcription when live voice is used.
- The text-to-speech endpoint receives the question text.
- The ElevenLabs Agent receives the transcript and limited story context needed to propose possible meanings.
- The Agent does not receive the incident evidence used later to verify its claims.
- Transcripts are not stored in a database.
- This prototype has no persistence. Refreshing the app starts the demonstration again.

A production deployment would need organisation-specific retention controls, access controls, audit policy, security review and integration permissions.

---

# Current limitations

This is a hackathon prototype, not a finished enterprise product.

Known limitations are intentionally documented.

## One main scenario

The current demonstration focuses on one software incident and one learned expert rule.

## Fixed concept vocabulary

The deterministic language checks are tuned to seven signals in the SRE demo.

If an expert describes the same idea using wording outside the supported vocabulary, SecondShift may reject a valid statement rather than guess.

That is a safe failure direction for this prototype.

## Simple follow-up interpretation

The follow-up answer is read using deterministic rules around yes/no wording and alternative actions.

This is why the expert must confirm the interpretation before advice changes.

## No long-term storage

Refreshing resets the demonstration.

There is no organisation account, database or history view.

## Seeded evidence

The incident data and benchmark are created for the demo.

SecondShift is not connected to a real monitoring system.

## Small benchmark

Fourteen hand-built incidents are useful for testing the mechanism but do not establish real-world accuracy.

## One expert at a time

The prototype does not yet combine lessons from multiple experts or resolve disagreements between them.

---

# What would come next

The next product steps are not "add more AI".

They are about connecting the learning mechanism to real work.

## 1. Detect real exceptions

SecondShift could listen for meaningful actions such as:

- deployment rollback
- feature flag change
- manual fraud approval
- unusual incident closure
- security alert override
- maintenance action different from the standard procedure

It would ask only when the worker's action meaningfully differs from what the normal process expected.

## 2. Build memory across many incidents

One explanation should not automatically become universal truth.

Future versions could collect confirming and conflicting examples across time.

Repeated confirmation would strengthen a lesson.

Disagreement between experts would be shown explicitly instead of averaged away.

## 3. Find outdated company instructions

If experienced workers repeatedly override the same procedure for the same reason, the problem may not be the workers.

The written procedure may be outdated.

A future SecondShift could show an **Organisational Blind Spot Map**:

```text
Official procedure
        vs
Where experienced workers repeatedly choose something else
```

That could help a company improve its procedures instead of simply teaching more exceptions.

## 4. Support human and AI workers

The same verified lesson could:

- coach a new employee
- appear inside an internal support tool
- become context for an enterprise AI agent
- act as a safety policy check before an automated action

## 5. Expand beyond software operations

The architecture can be adapted to other environments where procedures, exceptions and evidence exist.

The first useful expansion targets would be areas such as security operations, fraud review, claims processing and industrial troubleshooting.

---

# The long-term idea

SecondShift starts with a simple observation:

> **The moments where experienced people disagree with written instructions are often where the most valuable hidden knowledge lives.**

If SecondShift captured thousands of these moments across an organisation, it could eventually answer questions that normal documentation cannot:

- Where are employees repeatedly overriding our procedures?
- Which exceptions are consistently successful?
- Which procedures may be outdated?
- Where do our best workers disagree?
- What evidence changes their decisions?
- Which lessons are safe enough to teach a new employee?
- Which lessons are strong enough to provide to an AI agent?
- Where should an AI abstain and ask a human?

The long-term asset is not simply a library of recorded workflows.

It is a history of:

```text
context
+ expected action
+ expert's different action
+ expert explanation
+ supporting evidence
+ what would change the decision
+ confirmed alternative
+ later test cases
```

In short:

> **Most systems record what experts do. SecondShift tries to learn what changes their mind.**

---

# Glossary

A few terms appear in the interface and code because this was built for a technical hackathon.

Here is what they mean in normal language.

| Term | Simple meaning |
|---|---|
| Runbook / playbook | The company's written instructions |
| Divergence | The expert did something different from the normal instruction |
| Telemetry | Data showing what actually happened in the system |
| Semantic extraction | AI proposes what the expert may have meant |
| Verification | Check whether that interpretation is actually supported |
| Counterfactual | "What would change your mind?" |
| Decision boundary | The point where the expert's advice stops applying |
| Guardrail | A situation where the learned advice should not be used |
| Decision memory | The saved expert lesson |
| Abstain | SecondShift does not have enough evidence to make a recommendation |
| Provenance | Where a piece of advice came from |

---

# Hackathon

**Event:** Hack-Nation 2026 Global AI Hackathon  
**Challenge:** ElevenLabs, The AI Apprentice  
**Builder:** Lucas Tan  
**Project:** SecondShift

The challenge asks how expert knowledge can be captured before it disappears.

SecondShift's answer is:

> **Do not try to record everything an expert knows. Find the moments where the expert knows the normal instructions are not enough. Ask why there, learn the limit of the advice, verify it, and preserve that lesson.**

---

# Quick links

- **Live product:** https://hacknation-2026-eight.vercel.app/
- **Architecture:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **Judging evidence:** [docs/JUDGING.md](docs/JUDGING.md)
- **Demo walkthrough:** [docs/DEMO.md](docs/DEMO.md)
- **Current implementation status:** [STATUS.md](STATUS.md)

---

## Final one-line pitch

**SecondShift finds the moments where experienced workers know the company instructions are wrong, learns why, and preserves that judgment for the next person or AI.**
