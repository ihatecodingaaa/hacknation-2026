# Product

## Name

SecondShift

## Challenge

ElevenLabs: The AI Apprentice

## One Sentence

SecondShift watches experts work, detects when their decisions diverge from the obvious playbook, asks why at the right moment, learns the hidden decision boundary, and teaches that judgment to the next person.

## Hero Scenario

Production incident response.

A service starts failing.

The obvious action appears to be restarting it.

The expert instead rolls back the deployment.

SecondShift detects that the actual action differs from the expected action.

It asks why.

The expert explains that the error spike started immediately after the deployment and affects only the new version.

SecondShift asks a counterfactual question:

"Would you still roll back if latency increased but the error rate stayed normal?"

The answer is used to learn the hidden decision rule.

Later, a trainee sees a new incident and chooses restart.

SecondShift explains why rollback is the better decision using the learned expert rule and the original evidence.

## Core Product Idea

Do not merely capture steps.

Learn the conditions that make an expert choose one action over another.

## Core Objects

Observation
IncidentState
ExpectedAction
ActualAction
DecisionDivergence
ExpertExplanation
CounterfactualQuestion
DecisionRule
Evidence
Confidence
TraineeDecision

## Main Demo Flow

1. Show an incident.
2. System predicts expected action.
3. Expert picks a different action.
4. System detects the divergence.
5. ElevenLabs voice asks why.
6. Expert answers by voice.
7. System extracts a structured decision rule.
8. System asks one counterfactual question.
9. Rule is updated.
10. Decision graph is shown.
11. Switch to trainee mode.
12. Show a new unseen incident.
13. Trainee makes a wrong choice.
14. SecondShift explains the expert-derived rule and links back to the original evidence.

## Must Be Visible

- expected action
- actual action
- divergence
- why the system asked a question
- captured expert explanation
- learned decision rule
- confidence
- evidence/provenance
- trainee result

## Do Not Build

Authentication
Billing
Teams
Admin panel
Generic chatbot
Huge dashboard
Multiple industries
Mobile app
Unnecessary database
Complex multi-agent framework

## Success

A judge should understand within 30 seconds:

"This system learns the expert's judgment when the playbook is not enough."
