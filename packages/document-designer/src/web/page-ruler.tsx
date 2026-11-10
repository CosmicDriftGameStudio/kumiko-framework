import type { ReactNode } from "react";
import {
  applyCssVariables,
  type MarginsMm,
  type PaperSize,
  percentOfExtent,
  rulerHalfMarks,
  rulerMarks,
} from "./paper-geometry.ts";
import type { MarginSide } from "./pdf-meta.ts";

type RulerAxis = "horizontal" | "vertical";

const ZONE_EDGE_CLASS: Readonly<Record<MarginSide, string>> = {
  left: "inset-y-0 left-0 w-(--ruler-extent)",
  right: "inset-y-0 right-0 w-(--ruler-extent)",
  top: "inset-x-0 top-0 h-(--ruler-extent)",
  bottom: "inset-x-0 bottom-0 h-(--ruler-extent)",
};

function MarginZone({
  side,
  percent,
}: {
  readonly side: MarginSide;
  readonly percent: number;
}): ReactNode {
  return (
    <div
      data-testid={`page-ruler-margin-${side}`}
      className={`absolute bg-status-warn/20 ${ZONE_EDGE_CLASS[side]}`}
      ref={(element) => applyCssVariables(element, { "--ruler-extent": `${percent}%` })}
    />
  );
}

function RulerTick({
  cm,
  percent,
  axis,
}: {
  readonly cm: number;
  readonly percent: number;
  readonly axis: RulerAxis;
}): ReactNode {
  const horizontal = axis === "horizontal";
  return (
    <span
      data-ruler-cm={cm}
      className={
        horizontal
          ? "absolute inset-y-0 left-(--ruler-at) w-0"
          : "absolute inset-x-0 top-(--ruler-at) h-0"
      }
      ref={(element) => applyCssVariables(element, { "--ruler-at": `${percent}%` })}
    >
      <span
        className={
          horizontal
            ? "absolute top-0.5 left-0 -translate-x-1/2 leading-none"
            : "absolute top-0 left-0.5 -translate-y-1/2 leading-none"
        }
      >
        {cm}
      </span>
      <span
        className={
          horizontal
            ? "absolute bottom-0 left-0 h-1.5 border-l border-muted-foreground/70"
            : "absolute top-0 right-0 w-1.5 border-t border-muted-foreground/70"
        }
      />
    </span>
  );
}

function RulerHalfTick({
  mm,
  percent,
  axis,
}: {
  readonly mm: number;
  readonly percent: number;
  readonly axis: RulerAxis;
}): ReactNode {
  return (
    <span
      data-ruler-half={mm}
      className={
        axis === "horizontal"
          ? "absolute bottom-0 left-(--ruler-at) h-1 border-l border-muted-foreground/40"
          : "absolute top-(--ruler-at) right-0 w-1 border-t border-muted-foreground/40"
      }
      ref={(element) => applyCssVariables(element, { "--ruler-at": `${percent}%` })}
    />
  );
}

function RulerMarks({
  extentMm,
  axis,
}: {
  readonly extentMm: number;
  readonly axis: RulerAxis;
}): ReactNode {
  return (
    <>
      {rulerHalfMarks(extentMm).map((mark) => (
        <RulerHalfTick key={mark.mm} mm={mark.mm} percent={mark.percent} axis={axis} />
      ))}
      {rulerMarks(extentMm).map((mark) => (
        <RulerTick key={mark.cm} cm={mark.cm} percent={mark.percent} axis={axis} />
      ))}
    </>
  );
}

// A child of the paper wrapper: its percentages are the paper's, so it scales with the page.
export function PageRuler({
  size,
  margins,
}: {
  readonly size: PaperSize;
  readonly margins: MarginsMm;
}): ReactNode {
  return (
    <>
      <div
        data-testid="page-ruler-top"
        aria-hidden="true"
        className="pointer-events-none absolute -top-4 right-0 left-0 h-4 select-none overflow-hidden border-b bg-muted text-[9px] text-muted-foreground"
      >
        <MarginZone side="left" percent={percentOfExtent(margins.left, size.widthMm)} />
        <MarginZone side="right" percent={percentOfExtent(margins.right, size.widthMm)} />
        <RulerMarks extentMm={size.widthMm} axis="horizontal" />
      </div>
      <div
        data-testid="page-ruler-left"
        aria-hidden="true"
        className="pointer-events-none absolute top-0 -left-4 h-(--paper-height) w-4 select-none overflow-hidden border-r bg-muted text-[9px] text-muted-foreground"
      >
        <MarginZone side="top" percent={percentOfExtent(margins.top, size.heightMm)} />
        <MarginZone side="bottom" percent={percentOfExtent(margins.bottom, size.heightMm)} />
        <RulerMarks extentMm={size.heightMm} axis="vertical" />
      </div>
    </>
  );
}
