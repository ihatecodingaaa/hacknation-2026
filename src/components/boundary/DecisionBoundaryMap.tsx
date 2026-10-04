"use client";

import { useState, type ReactNode } from "react";
import { ACTIONS } from "@/domain/actions";
import type { AxisPosition, BoundaryAxis, BoundaryCell, BoundaryMapData, Placement } from "@/domain/boundary";
import { evidenceFor } from "@/domain/rules";
import type { DecisionRule } from "@/domain/types";
import { EvidenceItem } from "../RulePanel";
import { Tag, cx } from "../ui";
import { TONE_BOX, TONE_TEXT, describeOutcome } from "./outcome";

// Columns are the reasons the expert gave (rule conditions). Rows ask the rule
// engine what happens on the expert's incident when that one reason stays,
// stops being true, or cannot be measured. Every cell comes from
// deriveBoundaryMap(); a placed incident comes from placeIncident().

const ROWS: { key: AxisPosition; label: string; hint: string }[] = [
  { key: "inside", label: "As the expert saw it", hint: "inside the learned region" },
  { key: "flipped", label: "If this stops being true", hint: "one reason flipped, all else held" },
  { key: "missing", label: "If it cannot be measured", hint: "telemetry missing" },
];

function necessityTag(a: BoundaryAxis) {
  if (a.necessity === "confirmed") return <Tag tone="rule">boundary tested · v{a.testedIn}</Tag>;
  if (a.necessity === "broadened") return <Tag tone="diverge">broadened · v{a.testedIn}</Tag>;
  return <Tag>stated · v{a.introducedIn}</Tag>;
}

function Marker({ label, kind }: { label: string; kind: "source" | "incident" | "incident-minor" }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-[2px] px-1.5 py-px font-mono text-[11px]",
        kind === "source" && "bg-expert/15 text-expert",
        kind === "incident" && "bg-text font-semibold text-bg",
        kind === "incident-minor" && "border border-text/50 text-text",
      )}
    >
      <span aria-hidden>{kind === "source" ? "●" : "◆"}</span>
      {label}
    </span>
  );
}

function OutcomeCell({ cell, large, version }: { cell: BoundaryCell; large: boolean; version: number }) {
  const o = describeOutcome(cell.outcome, cell.runbook);
  const before = cell.before ? describeOutcome(cell.before, cell.runbook) : null;
  return (
    <div>
      <div className={cx("leading-snug text-muted", large ? "text-[13px]" : "text-[12px]")}>If {cell.scenario}:</div>
      {before && (
        <div className="mt-1.5 rounded-[2px] bg-rule/10 px-1.5 py-1 font-mono text-[11px] leading-snug">
          <span className="font-semibold uppercase tracking-wider text-rule">Moved in v{version}</span>
          <span className="text-muted"> · was: </span>
          <span className="text-muted line-through">{before.title}</span>
        </div>
      )}
      <div
        className={cx(
          "mt-1 rounded-[3px] border px-2 py-1.5",
          TONE_BOX[o.tone],
          before && "boundary-moved",
        )}
      >
        <div className={cx("font-semibold leading-tight", TONE_TEXT[o.tone], large ? "text-[15px]" : "text-[13px]")}>{o.title}</div>
        <div className="mt-0.5 font-mono text-[10.5px] leading-snug text-muted">{o.detail}</div>
      </div>
    </div>
  );
}

function PlacementResult({ placement, map, incidentId }: { placement: Placement; map: BoundaryMapData; incidentId: string }) {
  const o = describeOutcome(placement.outcome, placement.runbook);
  const deciding = map.axes.filter((a) => placement.decisiveAxes.includes(a.conditionId)).map((a) => a.label.toLowerCase());
  const where =
    placement.outcome.kind === "apply"
      ? "lands inside the learned region"
      : placement.outcome.kind === "abstain"
        ? `cannot be placed: ${deciding.join(", ")} not measured`
        : `crosses the boundary at: ${deciding.join(", ")}`;
  return (
    <div className={cx("mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 border px-3 py-2", TONE_BOX[o.tone])} role="status">
      <Marker label={incidentId} kind="incident" />
      <span className="text-[14px] text-text">{where}</span>
      <span aria-hidden className="text-faint">→</span>
      <span className={cx("text-[15px] font-semibold", TONE_TEXT[o.tone])}>{o.title}</span>
      <span className="font-mono text-[11px] text-muted">{o.detail}</span>
    </div>
  );
}

export function DecisionBoundaryMap({
  map,
  rule,
  placement,
  incidentId,
  size = "large",
}: {
  map: BoundaryMapData;
  rule: DecisionRule;
  placement?: Placement | null;
  incidentId?: string;
  size?: "large" | "compact";
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const large = size === "large";
  const cols = `minmax(128px, 0.7fr) repeat(${map.axes.length}, minmax(170px, 1fr))`;
  const sel = map.axes.find((a) => a.conditionId === selected) ?? null;
  const inside = describeOutcome(map.inside, map.overAction);

  function cellBody(a: BoundaryAxis, row: AxisPosition): ReactNode {
    const here = placement && incidentId && placement.positions[a.conditionId] === row;
    const decisive = Boolean(here && placement.decisiveAxes.includes(a.conditionId));
    // Off-axis but not the deciding reason: show where it is, without implying this cell decided.
    const minor = here && row !== "inside" && !decisive;
    const marker = here ? (
      <div className="space-y-0.5">
        <Marker label={incidentId} kind={minor ? "incident-minor" : "incident"} />
        {row !== "inside" && (
          <div className="font-mono text-[10.5px] leading-snug text-muted">
            {placement.details[a.conditionId]}
            {minor && <span className="text-faint"> · also outside, not the deciding reason</span>}
          </div>
        )}
      </div>
    ) : null;
    if (row === "inside") {
      return (
        <div className="flex h-full flex-col gap-1.5">
          <div className={cx("font-mono leading-snug text-text", large ? "text-[12.5px]" : "text-[11.5px]")}>{a.observed}</div>
          <div className="mt-auto flex flex-wrap gap-1">
            <Marker label={map.sourceIncidentId} kind="source" />
            {marker}
          </div>
        </div>
      );
    }
    return (
      <div className={cx("h-full", decisive && "rounded-[3px] outline outline-2 outline-offset-2 outline-text/80")}>
        <OutcomeCell cell={row === "flipped" ? a.flipped : a.missing} large={large} version={map.version} />
        {marker && <div className="mt-1.5">{marker}</div>}
      </div>
    );
  }

  return (
    <figure className="m-0" aria-label={`Decision boundary map for ${map.ruleId} v${map.version}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <figcaption className="flex flex-wrap items-baseline gap-x-2">
          <span className={cx("font-semibold text-text", large ? "text-[17px]" : "text-[14px]")}>
            {ACTIONS[map.action].label}
          </span>
          <span className="text-muted">instead of</span>
          <span className="text-expected">{ACTIONS[map.overAction].label}</span>
        </figcaption>
        <span className="font-mono text-[11px] text-faint">
          {map.ruleId} v{map.version} · every cell is computed by the rule engine
        </span>
      </div>

      <div className="mt-3 overflow-x-auto">
        <div className="grid min-w-[620px] gap-px bg-line" style={{ gridTemplateColumns: cols }} role="table">
          <div role="row" className="contents">
            <div role="columnheader" className="bg-panel px-3 py-2.5 font-mono text-[10.5px] uppercase tracking-wider text-faint">
              Expert&apos;s reasons →
            </div>
            {map.axes.map((a) => (
              <div role="columnheader" key={a.conditionId} className="flex bg-panel">
              <button
                type="button"
                aria-pressed={selected === a.conditionId}
                onClick={() => setSelected(selected === a.conditionId ? null : a.conditionId)}
                className={cx(
                  "w-full px-3 py-2.5 text-left transition-colors hover:bg-raised",
                  selected === a.conditionId && "bg-raised shadow-[inset_0_-2px_0_var(--rule)]",
                )}
              >
                <div className={cx("font-semibold leading-snug text-text", large ? "text-[15px]" : "text-[13px]")}>
                  {a.expected === "absent" ? "Not: " : ""}
                  {a.label}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1">{necessityTag(a)}</div>
                {a.quote && (
                  <div className="mt-1 line-clamp-2 text-[12px] italic leading-snug text-muted">&ldquo;{a.quote}&rdquo;</div>
                )}
              </button>
              </div>
            ))}
          </div>

          {ROWS.map((r) => (
            <div role="row" className="contents" key={r.key}>
              <div
                role="rowheader"
                className={cx("px-3 py-2.5", r.key === "inside" ? "bg-rule/[0.08]" : "bg-panel")}
              >
                <div className={cx("font-medium leading-snug", r.key === "inside" ? "text-rule" : "text-text", large ? "text-[13px]" : "text-[12px]")}>
                  {r.label}
                </div>
                <div className="mt-0.5 font-mono text-[10.5px] leading-snug text-faint">{r.hint}</div>
                {r.key === "inside" && (
                  <div className="mt-2">
                    <div className={cx("font-semibold text-rule", large ? "text-[14px]" : "text-[12.5px]")}>{inside.title}</div>
                    <div className="font-mono text-[10.5px] text-muted">{inside.detail}</div>
                  </div>
                )}
              </div>
              {map.axes.map((a) => (
                <div
                  role="cell"
                  key={a.conditionId}
                  className={cx(
                    "px-3 py-2.5",
                    r.key === "inside" ? "bg-rule/[0.08]" : "bg-panel",
                    selected === a.conditionId && r.key !== "inside" && "bg-raised",
                  )}
                >
                  {cellBody(a, r.key)}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {placement && incidentId && (
        <PlacementResult placement={placement} map={map} incidentId={incidentId} />
      )}

      {sel ? (
        <div className="mt-3 border border-line bg-panel px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[13px] font-semibold text-text">Why &ldquo;{sel.label}&rdquo; is in the rule</div>
            <button type="button" onClick={() => setSelected(null)} className="font-mono text-[11px] text-muted hover:text-text">
              close
            </button>
          </div>
          <div className="mt-1 font-mono text-[11px] text-faint">
            introduced in v{sel.introducedIn}
            {sel.testedIn ? ` · counterfactual in v${sel.testedIn}` : " · not boundary tested yet"}
          </div>
          <ul className="mt-2.5 grid gap-2.5 md:grid-cols-2">
            {evidenceFor(rule, rule.conditions.find((c) => c.id === sel.conditionId)?.evidenceIds ?? []).map((e) => (
              <EvidenceItem key={e.id} e={e} />
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-2 text-[12px] text-faint">Select a reason to see the expert&apos;s words, the telemetry and the counterfactual behind it.</p>
      )}
    </figure>
  );
}
