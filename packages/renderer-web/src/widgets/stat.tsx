import { usePrimitives } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

// KPI-Kacheln. `tone` steuert Value-/Chip-Farbe semantisch (default |
// positive | warn), `accentColor` färbt NUR den Icon-Chip mit einer
// App-semantischen Farbe (z.B. Finanz-Rollen) — Value/Delta/Sparkline
// bleiben an `tone`.

export type StatTone = "default" | "positive" | "warn";

const TONE_CHIP: Record<StatTone, string> = {
  default: "bg-muted text-foreground",
  positive: "bg-primary/10 text-primary",
  warn: "bg-destructive/10 text-destructive",
};

const TONE_VALUE: Record<StatTone, string> = {
  default: "text-foreground",
  positive: "text-primary",
  warn: "text-destructive",
};

export type StatDelta = {
  readonly value: string;
  readonly direction: "up" | "down";
  readonly tone?: StatTone;
};

// Inline-SVG-Sparkline (kein Chart-Dep für eine 28px-Kurve): Linie +
// schwacher Flächen-Verlauf, Farbe via currentColor (Caller setzt text-tone).
export function Sparkline({
  points,
  className,
}: {
  readonly points: readonly number[];
  readonly className?: string;
}): ReactNode {
  if (points.length < 2) return null;
  const w = 100;
  const h = 28;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const line = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p - min) / span) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={className ?? "h-7 w-full"}
      aria-hidden="true"
    >
      <path d={`${line} L${w},${h} L0,${h} Z`} fill="currentColor" fillOpacity={0.12} />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** Icon-tragende Kennzahl-Kachel mit optionalem Delta-Chip, Trend-Zeile
 *  und Sparkline. `icon` ist ein fertiger Knoten (App liefert ihr SVG). */
export function StatCard({
  icon,
  label,
  value,
  sub,
  tone = "default",
  accentColor,
  delta,
  trend,
  spark,
  testId,
}: {
  readonly icon?: ReactNode;
  readonly label: string;
  readonly value: string;
  readonly sub?: string;
  readonly tone?: StatTone;
  readonly accentColor?: string;
  readonly delta?: StatDelta;
  readonly trend?: string;
  readonly spark?: readonly number[];
  readonly testId?: string;
}): ReactNode {
  const { Card } = usePrimitives();
  return (
    <Card options={{ padded: false }} className="p-4" testId={testId}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-muted-foreground">
          {icon !== undefined && (
            <span
              className={cn(
                "flex size-7 items-center justify-center rounded-lg",
                accentColor === undefined && TONE_CHIP[tone],
              )}
              style={
                accentColor === undefined
                  ? undefined
                  : {
                      color: accentColor,
                      backgroundColor: `color-mix(in srgb, ${accentColor} 12%, transparent)`,
                    }
              }
            >
              {icon}
            </span>
          )}
          <span className="text-xs font-medium">{label}</span>
        </div>
        {delta !== undefined && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums",
              TONE_CHIP[delta.tone ?? tone],
            )}
          >
            {delta.direction === "up" ? "↑" : "↓"}
            {delta.value}
          </span>
        )}
      </div>
      <div className="mt-2 text-xl font-semibold tabular-nums text-foreground">{value}</div>
      {sub !== undefined && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      {trend !== undefined && (
        <div className="mt-0.5 text-xs font-medium text-foreground/80">{trend}</div>
      )}
      {spark !== undefined && (
        <Sparkline points={spark} className={cn("mt-2 h-7 w-full", TONE_VALUE[tone])} />
      )}
    </Card>
  );
}

/** Kompakte Kennzahl-Kachel (ohne Icon) — für dichte KPI-Raster.
 *  StatCard ist die icon-tragende Variante. */
export function MiniStat({
  label,
  value,
  tone = "default",
  emphasize = false,
  testId,
}: {
  readonly label: string;
  readonly value: string;
  readonly tone?: StatTone;
  readonly emphasize?: boolean;
  readonly testId?: string;
}): ReactNode {
  const { Card } = usePrimitives();
  return (
    <Card
      options={{ padded: false }}
      className={cn("p-3", emphasize && "ring-1 ring-primary/30")}
      testId={testId}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-0.5 font-semibold tabular-nums",
          TONE_VALUE[tone],
          emphasize ? "text-lg" : "text-sm",
        )}
      >
        {value}
      </div>
    </Card>
  );
}
