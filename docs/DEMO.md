# Demo

## Demo Story

A production incident appears.

Current signals:
- new deployment completed 8 minutes ago
- HTTP 5xx errors jumped from 0.3% to 9.8%
- latency increased
- CPU is normal
- database is healthy
- only the newly deployed version is affected

The system predicts:

Expected action: Restart service

The expert instead chooses:

Actual action: Roll back deployment

SecondShift detects:

Decision divergence

It asks:

"You rolled back instead of restarting. What made you choose that?"

Expert answer:

"The failures started right after the deployment and only the new version is affected. Restarting would just restart the bad version."

The system extracts:

Rule:
IF errors rise immediately after a deployment
AND only the new version is affected
THEN prefer rollback over restart

Guardrail:
Do not apply this rule if the problem affects all versions or the deployment timing does not match the failure.

Counterfactual question:

"If latency increased but the error rate stayed normal, would you still roll back?"

Expert answer:

"No. I would investigate first because latency alone is not enough evidence that the deployment caused the incident."

The system updates the rule.

## Trainee Test

New incident:
- deployment completed 6 minutes ago
- 5xx errors rose sharply
- only new instances fail
- database healthy

Trainee chooses:

Restart service

SecondShift responds:

Mismatch with learned expert rule.

Recommended:
Roll back deployment

Reason:
The failure pattern matches the expert's captured rollback condition.

Evidence:
Show original expert explanation and the incident signals that produced the rule.

## Judge Message

SecondShift does not record what experts do.

It learns when they would do something different.
