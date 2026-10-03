@AGENTS.md

# Hack-Nation 2026 Project Rules

## Goal

Build a polished, working Hack-Nation submission with a strong live demo.

The priority order is:

1. Working core idea
2. Reliable demo
3. Technical depth
4. Clear visual explanation
5. Tests
6. Deployment
7. Polish

Do not waste time building features that judges will not see.

## Design

Do not make the interface look like generic AI-generated software.

Avoid:
- purple gradient everywhere
- glowing blobs
- excessive glass effects
- too many rounded cards
- fake statistics
- meaningless charts
- random animations
- generic chatbot layouts unless chat is genuinely needed
- giant empty marketing pages

Every major visual element should help explain what the product is doing.

## Engineering

Keep the code simple and easy to understand.

Do not create unnecessary:
- services
- databases
- queues
- agent frameworks
- abstractions
- integrations
- authentication
- billing
- admin panels

Use AI only where AI is genuinely useful.

Use normal code for things that need exact answers.

Do not pretend fake demo data is live data.

If an outside API fails, handle it cleanly.

## Git

The repository owner is the only author.

Never change:
- git user.name
- git user.email

Never add:
- Co-authored-by
- Claude attribution
- Anthropic attribution
- ChatGPT attribution
- OpenAI attribution
- bot attribution

Do not put AI attribution in commit messages, README files, comments, or generated documentation unless the hackathon explicitly requires it.

## Before Saying Something Is Finished

Run:

npm run lint
npm run build

Run tests too once tests exist.

Fix failures before moving on.

## Deadline Rule

Do not keep expanding the project after the main demo works.

Once the core flow works:
1. make it reliable
2. make it understandable
3. make it look excellent
4. test it
5. deploy it

## Status

Keep a STATUS.md file updated with:
- what works
- what does not work
- current problems
- tests run
- next task
