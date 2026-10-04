# Product

## Name

SecondShift

## Challenge

Hack-Nation 2026, ElevenLabs: The AI Apprentice

## One-line pitch

> **The company instructions say one thing. The expert does something else. SecondShift learns why.**

## What SecondShift is

SecondShift captures the useful judgment that experienced workers carry in their heads but never wrote down.

Most companies already have written instructions, checklists, procedures, manuals and training material.

Those documents explain what normally should happen.

Experienced workers know something extra:

- when the normal instruction is wrong
- when an exception is safe
- when the same exception becomes unsafe
- which warning signs matter
- when to stop and investigate
- when the obvious action should not be taken

That judgment often disappears when the employee retires, resigns, changes teams, or is simply unavailable.

SecondShift tries to preserve it.

## The core insight

Do not ask an expert to explain everything they know.

Instead, notice when:

```text
company instructions suggest X
but
expert chooses Y
```

That disagreement is a useful signal.

SecondShift asks:

> Why did you do something different?

Then it asks:

> What would make you choose differently?

Those two questions reveal both the expert's reasoning and the limit of that reasoning.

## Why this is different from normal documentation

A normal workflow recorder can tell you:

> The engineer rolled back the deployment.

SecondShift tries to learn:

> The engineer rolled back because only the new version was failing.

And then:

> If every version were failing, the engineer would not roll back. They would hold and investigate.

That is more useful than simply recording the original action.

## Current demo

The prototype uses a software-operations incident.

A service starts failing.

The company instructions suggest:

> Restart the service.

The experienced engineer chooses:

> Roll back the latest deployment.

SecondShift notices the difference and asks why.

The expert explains:

> The failures started right after the deployment, and only the new version is affected.

SecondShift checks whether those reasons are supported.

It then asks a follow-up question such as:

> If the failures were not isolated to the new version, would you still roll back?

The expert answers:

> No. I would hold and investigate instead.

After the expert confirms that SecondShift understood correctly, the learned advice changes.

The interface can show:

```text
MOVED IN V2
was: Rule is silent
→ Hold and investigate
```

That change is calculated from the real rule, not drawn by hand.

## Who could use this

The current demo is software operations, but the idea is broader.

SecondShift is useful wherever there are:

1. written procedures
2. experienced workers
3. recurring exceptions
4. costly mistakes
5. evidence that can help check what happened

Potential future areas include:

- software operations
- cybersecurity
- fraud review
- insurance claims
- financial operations
- industrial maintenance
- customer support
- logistics
- compliance operations

## How it could create value

### Faster problem solving

A new employee should not have to rediscover a lesson that an experienced worker already learned.

### Fewer interruptions to senior staff

A senior employee should not have to explain the same exception repeatedly.

### Faster training

New workers can learn not only the official procedure, but also when experienced people know the procedure is not enough.

### Less knowledge loss

When an experienced worker leaves, more of their judgment can remain inside the organisation.

### Better context for future AI agents

AI agents can read procedures and documents.

They often do not know the unwritten exceptions experienced humans use.

SecondShift aims to create verified decision memory that can later be given to both people and AI systems.

## Why voice

Voice is a capture method, not the product.

The product is the preserved judgment.

Voice is useful because a worker can answer a short question immediately while the reasoning is still fresh.

For a real product, the same flow could also support:

- typing
- Slack
- Microsoft Teams
- quick annotations

For this hackathon, ElevenLabs provides the voice layer.

## What the current product proves

The prototype proves that SecondShift can:

- detect when an expert chooses something different from the normal instruction
- ask why using ElevenLabs
- capture the answer by voice
- propose possible meaning from messy speech
- verify the proposed meaning before learning it
- reject unsupported interpretations
- ask what would change the expert's mind
- require confirmation before updating learned advice
- show how the advice changes
- apply the lesson to unseen incidents
- abstain when evidence is missing
- export the result as structured decision memory
- benchmark the learned memory on seeded test cases

## What the current product does not claim

This is a hackathon prototype.

It does not claim:

- production accuracy
- a complete enterprise deployment
- fully autonomous decision making
- support for every industry
- long-term employee monitoring
- that one expert answer should become company truth
- that the benchmark represents real-world performance

## Long-term direction

The long-term opportunity is larger than training.

If SecondShift captured many expert exceptions across a company, it could eventually reveal:

- which written procedures are repeatedly overridden
- which exceptions are repeatedly successful
- where senior workers disagree
- which evidence changes expert decisions
- where the organisation's written process may be outdated
- where AI agents should abstain and ask a human

A future view could compare:

```text
how the company says work should happen
vs
how its best people actually make decisions
```

That can become useful for training, process improvement, automation and AI-agent safety.

## Product principles

SecondShift follows several principles:

1. **Learn from exceptions, not everything.**
2. **Ask at the moment the judgment is fresh.**
3. **The model may propose, but code decides what can be learned.**
4. **Preserve the expert's original words.**
5. **Missing evidence should remain unknown.**
6. **Human confirmation is required before a risky interpretation changes advice.**
7. **Show where advice came from.**
8. **Prefer refusing to learn over preserving the wrong lesson.**

## Success condition

A first-time viewer should understand SecondShift as:

> **The system that spots when an experienced worker knows the normal instructions are not enough, learns why, and preserves that lesson for the next person or AI.**
