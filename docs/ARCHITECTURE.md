# Architecture

## Keep It Simple

One Next.js application.

No database unless absolutely necessary.

Use local typed demo data for the hackathon.

## Main Parts

1. Incident simulator
Shows the incident state and available actions.

2. Expected-action engine
Produces the expected next action from the current incident.

3. Divergence detector
Compares expected action with the expert's actual action.

4. Voice capture
Use ElevenLabs real-time speech-to-text where possible.

5. Rule extractor
Turns the expert explanation into a structured decision rule.

6. Counterfactual generator
Asks one targeted question that helps identify where the expert would change their decision.

7. Decision memory
Stores the rule, guardrail, evidence and confidence.

8. Trainee evaluator
Checks a trainee's decision against the learned rule.

9. Decision visualization
Shows how the rule was learned and what evidence supports it.

## Reliability

Real ElevenLabs integration is preferred.

If API credentials are unavailable or the API fails:
- keep a clearly labelled demo fallback
- never pretend fallback output is live

## Technical Principle

Use normal code for:
- incident state
- action comparison
- scoring
- rule matching
- trainee evaluation

Use AI for:
- speech transcription
- extracting expert reasoning
- generating counterfactual questions
- natural-language explanation

## Core Proof

The product must visibly show that a rule learned from one incident can correctly guide a different incident.
