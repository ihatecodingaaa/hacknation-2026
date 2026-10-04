# Demo Guide

This file contains two short walkthroughs:

1. a **60-second product demo** for a first-time viewer
2. a **60-second technical walkthrough** for judges who want to understand how SecondShift works

For both, use the deployed app:

https://hacknation-2026-eight.vercel.app/

Use **Story view** unless the technical walkthrough explicitly mentions Analyst view.

---

# 60-second product demo

## Goal

A first-time viewer should understand:

> **The company instructions say one thing. The expert does something else. SecondShift learns why.**

Avoid technical words in this version.

Do not say:

- runbook
- telemetry
- semantic extraction
- counterfactual
- decision boundary

Use normal language instead.

---

## 0:00 to 0:08

Start in **01 Before**.

Choose:

**Roll back deployment**

This moves to **02 Surprise**.

Say:

> "Every company has instructions. But their best employees know when those instructions are wrong. Here, the instructions say restart, but the expert rolls back instead."

Keep the screen on:

```text
Restart service ≠ Roll back deployment
```

---

## 0:08 to 0:20

Click:

**Ask the expert why**

Let ElevenLabs ask the question.

Answer by voice:

> "Only the new version is failing. It started failing right after the deployment. Restarting would just restart the bad version."

Wait for the transcript and claim checks.

Say:

> "SecondShift notices that difference, asks why, and checks the explanation before learning anything."

---

## 0:20 to 0:38

Click:

**Probe the boundary**

Answer the follow-up:

> "No. If all versions were failing, I would hold and investigate instead."

If needed:

1. choose **No, would not roll back**
2. choose **Hold and investigate**
3. click **Confirm interpretation**

Keep the screen on:

```text
MOVED IN V2
was: Rule is silent
→ Hold and investigate
```

Say:

> "Then it asks what would change the expert's mind, so it learns when that advice should stop applying."

---

## 0:38 to 0:50

Click:

**Test on incidents the expert never saw**

Show the Transfer screen.

Say:

> "Now that judgment can guide another employee through a situation the expert has never seen."

---

## 0:50 to 1:00

Open **06 Memory**.

Say:

> "And that lesson becomes company memory for the next employee or AI agent. SecondShift finds the knowledge nobody knew needed documenting."

End on the SecondShift name.

---

# 60-second technical walkthrough

## Goal

Show that SecondShift is not simply a voice interface or an LLM wrapper.

The core technical message is:

> **The model proposes. Code decides.**

---

## 0:00 to 0:10

Show **03 Why** with the transcript and claim table.

Say:

> "SecondShift is designed so AI cannot directly write company rules. The model can only propose what the expert meant."

Point at the transcript and candidate claims.

---

## 0:10 to 0:25

Point at the verification results.

Say:

> "Every claim must pass four checks: the quote must really exist, the expert's words must support the claim, the expert must not sound uncertain, and the incident evidence must agree."

If available, show a rejected claim.

The strongest example is:

```text
REJECTED: QUOTE DOES NOT SUPPORT CLAIM
```

Say:

> "Even if the system evidence agrees, SecondShift rejects a claim when the expert's own words do not support it."

---

## 0:25 to 0:40

Open **04 Boundary**.

Show the follow-up interpretation and confirmation.

Say:

> "The second question tests when the original advice stops working. A live voice answer cannot change the rule until the expert confirms how SecondShift understood it."

Show:

```text
Confirm interpretation
```

Then show:

```text
MOVED IN V2
was: Rule is silent
→ Hold and investigate
```

---

## 0:40 to 0:52

Open **06 Memory**.

Show the benchmark.

Say:

> "The learned judgment is tested on fourteen seeded incidents the expert never saw. The normal instructions score five of fourteen, memory version one scores ten, and version two scores eleven, with one abstention."

Add:

> "These are seeded test cases, not production accuracy claims."

---

## 0:52 to 1:00

Show the structured memory or SecondShift name.

Say:

> "The final lesson is exported as structured decision memory that can be reused by another employee or future AI agent. The model proposes. Code decides."

---

# Best technical example to explain

A real microphone run exposed this case.

Speech recognition heard wording similar to:

> "The video started right after the deployment."

The AI proposed:

> "Failure began right after a deploy."

The incident data really did show a failure after the deployment.

SecondShift rejected the claim anyway because the expert's words did not say that anything failed.

That behaviour exists because proposal and verification are separate.

This is the most important example if a technical judge asks why the architecture is more than a prompt.

---

# What to show if a judge has more time

## Story view

Use the six chapters:

1. Before
2. Surprise
3. Why
4. Boundary
5. Transfer
6. Memory

## Analyst view

Open:

```text
https://hacknation-2026-eight.vercel.app/?view=analyst
```

Use this only when the judge wants more detail.

It shows:

- incident data
- learned conditions
- evidence
- advice strength
- benchmark cases
- structured memory

---

# Extra demo paths

## Expert follows the normal instruction

In **01 Before**, choose:

**Restart service**

Expected behaviour:

- no disagreement
- no "why" question
- nothing learned

This shows that SecondShift is not trying to record every normal action.

## Vague explanation

Use the vague-answer path.

Expected behaviour:

- unsupported or unverifiable explanation
- no useful rule learned
- reason shown

## Missing evidence

In Transfer, use the case with missing per-version information.

Expected behaviour:

- SecondShift does not pretend to know
- the result is an abstention or cannot-confirm state

---

# If live voice fails

The demo has fallbacks.

## Text to speech fails

The question remains visible as text.

Continue with the written question.

## Microphone or Scribe fails

Use the typed answer.

If necessary, use the scripted answer.

The interface labels the source.

## ElevenLabs Agent extraction fails

SecondShift falls back to the deterministic phrase matcher.

The interface shows which path was used.

---

# Recommended closing line

For a general audience:

> **"SecondShift finds the moments where experienced workers know the company instructions are not enough, learns why, and preserves that lesson."**

For a technical audience:

> **"The model proposes. Code decides."**
