import { type ReactNode, useId } from "react";
import { STATUS_TONE_TEXT, type StatusTone } from "./status-badge";

// Inline-SVG-Charts — kein Chart-Dep. Farben ausschließlich über die
// --color-status-* / --color-foreground Theme-Tokens; Achsen-Labels
// kommen translated vom Caller (keine Locale-Annahmen im Widget).

const TONE_VAR: Record<StatusTone, string> = {
  ok: "var(--color-status-ok)",
  warn: "var(--color-status-warn)",
  bad: "var(--color-status-bad)",
  critical: "var(--color-status-critical)",
  muted: "var(--color-muted-foreground)",
};

export type StatusBarEntry = {
  /** Stable key (z.B. ISO-Datum). */
  readonly key: string;
  /** Balkenhöhe 0..1 (z.B. operational=1, degraded=0.75, outage=0.25). */
  readonly level: number;
  readonly tone: StatusTone;
  /** Tooltip-Text (<title>) — translated vom Caller. */
  readonly label?: string;
};

/** Status-Balkenleiste (z.B. 90-Tage-Uptime): variable-height Bars mit
 *  Gradient-Fade + Tick-Line am Bar-Top; der letzte Eintrag bekommt einen
 *  „jetzt"-Accent-Stripe. */
export function StatusBarChart({
  entries,
  ariaLabel,
  startLabel,
  endLabel,
  highlightLast = true,
  testId,
}: {
  readonly entries: readonly StatusBarEntry[];
  readonly ariaLabel: string;
  /** Achsen-Beschriftung links/rechts unter dem Chart — translated. */
  readonly startLabel?: string;
  readonly endLabel?: string;
  readonly highlightLast?: boolean;
  readonly testId?: string;
}): ReactNode {
  const gradPrefix = useId();
  if (entries.length === 0) return <div className="h-9" aria-hidden />;

  const chartHeight = 36;
  const tickHeight = 1;
  const barGap = 1;
  const lastIdx = entries.length - 1;

  return (
    <div data-testid={testId}>
      <svg
        viewBox={`0 0 ${entries.length * (1 + barGap)} ${chartHeight}`}
        preserveAspectRatio="none"
        className="block h-9 w-full"
        role="img"
        aria-label={ariaLabel}
      >
        <title>{ariaLabel}</title>
        {entries.map((entry, idx) => {
          const x = idx * (1 + barGap);
          const level = Math.max(0, Math.min(1, entry.level));
          const barHeight = (chartHeight - tickHeight) * level;
          const barY = chartHeight - barHeight;
          const isLast = highlightLast && idx === lastIdx;
          const color = TONE_VAR[entry.tone];
          const gradId = `${gradPrefix}-${idx}`;
          return (
            <g key={entry.key}>
              <defs>
                <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={isLast ? 0.85 : 0.5} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.05} />
                </linearGradient>
              </defs>
              {isLast && (
                <rect
                  x={x - 0.5}
                  y={0}
                  width={2}
                  height={chartHeight}
                  fill="var(--color-foreground)"
                  fillOpacity={0.06}
                />
              )}
              <rect x={x} y={barY} width={1} height={barHeight} fill={`url(#${gradId})`}>
                {entry.label !== undefined && <title>{entry.label}</title>}
              </rect>
              <rect
                x={x}
                y={barY - tickHeight}
                width={1}
                height={tickHeight}
                fill="var(--color-foreground)"
                fillOpacity={isLast ? 1.0 : 0.7}
              />
            </g>
          );
        })}
      </svg>
      {(startLabel !== undefined || endLabel !== undefined) && (
        <div className="mt-0.5 flex justify-between text-[11px] text-muted-foreground">
          <span>{startLabel}</span>
          <span>{endLabel}</span>
        </div>
      )}
    </div>
  );
}

/** Quadratic-durch-Mittelpunkte-Trick: glättet die Zick-Zack-Linie ohne
 *  Overshoot (~5 Zeilen statt Catmull-Rom/Bezier-Fit). */
export function smoothPath(pts: ReadonlyArray<{ readonly x: number; readonly y: number }>): string {
  const first = pts[0];
  if (!first) return "";
  let d = `M ${first.x.toFixed(1)} ${first.y.toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const cur = pts[i];
    const next = pts[i + 1];
    if (!cur || !next) break;
    const midX = (cur.x + next.x) / 2;
    const midY = (cur.y + next.y) / 2;
    d += ` Q ${cur.x.toFixed(1)} ${cur.y.toFixed(1)}, ${midX.toFixed(1)} ${midY.toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  if (!last) return d;
  return `${d} L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
}

export type TimeseriesPoint = {
  readonly atMs: number;
  /** null = Ausfall/kein Wert → fällt auf die Grundlinie (sichtbarer Einbruch). */
  readonly value: number | null;
};

/** Zeitreihen-Linien-Chart (geglättete Linie + Flächen-Verlauf). x-Achse =
 *  ZEIT im Fenster windowStartMs..windowEndMs, nicht Index — 5 Min Daten in
 *  einem 30-Tage-Fenster ergeben ehrlich einen schmalen Streifen rechts. */
export function TimeseriesChart({
  points,
  windowStartMs,
  windowEndMs,
  tone = "ok",
  ariaLabel,
  axisLabels,
  emptyContent,
  testId,
}: {
  readonly points: readonly TimeseriesPoint[];
  readonly windowStartMs: number;
  readonly windowEndMs: number;
  readonly tone?: StatusTone;
  readonly ariaLabel: string;
  /** Achsen-Zeile unter dem Chart (translated/formatiert vom Caller). */
  readonly axisLabels?: { readonly start: string; readonly mid?: string; readonly end: string };
  /** Rendert statt des Charts wenn <2 Messwerte vorliegen. */
  readonly emptyContent?: ReactNode;
  readonly testId?: string;
}): ReactNode {
  const gradientId = useId();
  const chartWidth = 300;
  const chartHeight = 64;

  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  if (values.length < 2) {
    return (
      <div className="flex h-16 items-center justify-center text-[13px] text-muted-foreground">
        {emptyContent}
      </div>
    );
  }

  const maxValue = Math.max(...values, 1);
  const span = Math.max(1, windowEndMs - windowStartMs);
  const xOf = (atMs: number) =>
    Math.max(0, Math.min(1, (atMs - windowStartMs) / span)) * chartWidth;
  const chartPoints = points.map((p) => ({
    x: xOf(p.atMs),
    y: p.value === null ? chartHeight : chartHeight - (p.value / maxValue) * chartHeight,
  }));
  const linePath = smoothPath(chartPoints);
  const firstPoint = chartPoints[0];
  const lastPoint = chartPoints[chartPoints.length - 1];
  const areaPath =
    firstPoint && lastPoint
      ? `${linePath} L ${lastPoint.x.toFixed(1)} ${chartHeight} L ${firstPoint.x.toFixed(1)} ${chartHeight} Z`
      : "";
  const color = TONE_VAR[tone];

  return (
    <div data-testid={testId} className={STATUS_TONE_TEXT[tone]}>
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        preserveAspectRatio="none"
        className="block h-16 w-full"
        role="img"
        aria-label={ariaLabel}
      >
        <title>{ariaLabel}</title>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {axisLabels !== undefined && (
        <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
          <span>{axisLabels.start}</span>
          {axisLabels.mid !== undefined && <span>{axisLabels.mid}</span>}
          <span>{axisLabels.end}</span>
        </div>
      )}
    </div>
  );
}
