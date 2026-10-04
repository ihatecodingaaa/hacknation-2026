import type { IncidentState } from "@/domain/types";

const W = 268;
const H = 76;
const PAD = { l: 26, r: 6, t: 8, b: 14 };

/** 5xx rate for the last 20 minutes with the deploy marked. */
export function ErrorChart({ incident, wide = false }: { incident: IncidentState; wide?: boolean }) {
  const series = incident.errorSeries;
  const n = series.length;
  const max = Math.max(2, ...series) * 1.15;
  const x = (i: number) => PAD.l + (i / (n - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const points = series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${x(0)},${y(0)} ${points} ${x(n - 1)},${y(0)}`;
  const deployIdx = incident.deploy ? n - 1 - incident.deploy.completedMinutesAgo : null;
  const threshold = Math.max(2, incident.errorRatePct.baseline * 3);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={wide ? "block w-full max-w-[540px]" : "block w-full max-w-[360px]"}
      role="img"
      aria-label={`5xx error rate over the last ${n} minutes${incident.deploy ? `, deploy ${incident.deploy.version} marked` : ""}`}
    >
      <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} stroke="var(--line-strong)" />
      <line
        x1={PAD.l}
        x2={W - PAD.r}
        y1={y(threshold)}
        y2={y(threshold)}
        stroke="var(--faint)"
        strokeDasharray="2 3"
      />
      <text x={PAD.l - 4} y={y(threshold) + 3} textAnchor="end" fontSize="8" fill="var(--faint)" fontFamily="var(--font-geist-mono)">
        {threshold.toFixed(0)}%
      </text>
      <text x={PAD.l - 4} y={y(0) + 3} textAnchor="end" fontSize="8" fill="var(--faint)" fontFamily="var(--font-geist-mono)">
        0
      </text>
      <polygon points={area} fill="var(--bad)" opacity="0.12" />
      <polyline points={points} fill="none" stroke="var(--bad)" strokeWidth="1.5" strokeLinejoin="round" />
      {deployIdx !== null && deployIdx >= 0 && (
        <g>
          <line
            x1={x(deployIdx)}
            x2={x(deployIdx)}
            y1={PAD.t - 4}
            y2={y(0)}
            stroke="var(--expert)"
            strokeDasharray="3 2"
          />
          <text
            x={x(deployIdx) - 3}
            y={PAD.t + 4}
            textAnchor="end"
            fontSize="8.5"
            fill="var(--expert)"
            fontFamily="var(--font-geist-mono)"
          >
            deploy {incident.deploy?.version}
          </text>
        </g>
      )}
      <text x={PAD.l} y={H - 2} fontSize="8" fill="var(--faint)" fontFamily="var(--font-geist-mono)">
        -{n - 1}m
      </text>
      <text x={W - PAD.r} y={H - 2} textAnchor="end" fontSize="8" fill="var(--faint)" fontFamily="var(--font-geist-mono)">
        now
      </text>
    </svg>
  );
}
