# Demo script (about 3 minutes)

Open http://localhost:3000 (Story view). Press **Reset demo** first. With `ELEVENLABS_API_KEY` set, the header shows *Voice: ElevenLabs*; without it, use the scripted answers (they are labelled as scripted everywhere).

Line to open with, if you need one: *"The playbook tells you what usually works. We learn when the expert knows it's wrong."*

## 0:00 to 0:20 · 01 Before

- Point at the incident: checkout-api, 5xx 0.3% → 9.8%, deploy v2.14.0 eight minutes ago. The chart marks the deploy right before the climb.
- Point at **Runbook prediction: Restart service** (RB-3). Read the *Reads / Ignores* line: the runbook looks at the error rate and ignores deploy timing and version scope.
- Say: *"SecondShift first predicts the obvious move, so it can notice when an expert does something else."*

## 0:20 to 0:40 · 02 Surprise

- Click **Roll back deployment**.
- The screen shows *Restart service ≠ Roll back deployment* and the three signals the runbook did not read.
- Say: *"That difference is the knowledge. If the expert had restarted, we'd stay quiet; there'd be nothing to learn."*

## 0:40 to 1:15 · 03 Why

- Click **Ask the expert why**. ElevenLabs speaks the question.
- Click **Answer by voice** and say: *"The failure started right after the deployment and only the new version is affected. Restarting won't just restart the bad version."* Click **Stop recording**, then **Learn from this answer**. (Offline: **Use scripted answer**.)
- Point at the transcript (verbatim, tagged *ElevenLabs Scribe v2 Realtime · live*) and the table: each claim, the telemetry, **SUPPORTED**.
- Say: *"A model may propose claims, but code decides. Each claim must be in the transcript, observable, and agree with the telemetry. Only then is it learned."*

## 1:15 to 1:45 · 04 Boundary (the moment)

- Click **Probe the boundary**. The map appears: three columns, one per reason. Rows show what the rule does if a reason holds, flips, or is missing. Every cell is computed by the rule engine.
- ElevenLabs asks: *"If latency increased but the error rate stayed normal, would you still roll back?"*
- Answer: *"No. I'd investigate first, latency alone isn't enough evidence the deploy caused it."* Click **Update the rule**. (Offline: **Use scripted answer**.)
- Point at the error-rate column: **Moved in v2 · was: Rule is silent → Hold and investigate**. Evidence strength 0.65 → 0.85 (heuristic, capped: one incident).
- Say: *"One question moved the boundary. Now the rule knows where it stops."*

## 1:45 to 2:30 · 05 Transfer

- Click **Test on incidents the expert never saw**.
- Case **A** (payments-gateway): click **Restart service**. *Mismatch with the learned expert rule.* Runbook says restart, the expert's rule says roll back. The map shows INC-2057 landing inside the learned region. The provenance shows the expert's own words from INC-2041.
- Case **C** (inventory-api): click **Roll back deployment**. *Crosses a boundary the expert set*; the deciding column is the counterfactual one.
- Case **D** (missing per-version data): any choice gives *Cannot confirm: missing evidence*. Say: *"It knows what it doesn't know."*
- Optional: case **B**, every version failing, rollback is blocked by a guardrail.

## 2:30 to 3:00 · 06 Memory

- Click **Same judgment, machine-readable**.
- Point at the three rows: runbook only 5/14, + memory v1 10/14, + memory v2 11/14 with 1 abstention. Click a red square (BM-06) to show an honest miss.
- Point at the JSON artifact and switch to **As agent context**.
- Close: *"The same judgment we just taught a trainee is machine-readable. It can train the next engineer, or become context or a policy check for an enterprise agent."*

## Extra paths if asked

- **Expert follows the runbook:** in 01, click Restart service. Nothing is asked, nothing is learned.
- **Vague answer:** in 03, click **Try a vague answer** ("it just felt off"). No rule is learned, and the screen says why.
- **Analyst view** (header toggle or `/?view=analyst`): the full three-pane console with the rule, guardrails, evidence strength factors, evidence list, the benchmark table and the decision memory.

## If something fails live

- TTS fails: the question is on screen; the line under it says *ElevenLabs TTS failed · text only*. Read it aloud and carry on.
- Microphone or Scribe fails: the error is shown under the voice button. Type the answer or use the scripted one. Its tag will say so.
- Semantic extractor fails: the phrase matcher is used and the reason is shown at the bottom of the claims table.
