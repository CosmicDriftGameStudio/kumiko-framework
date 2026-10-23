import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import { SINGLE_POINT_RADIUS } from "./chart-data.ts";
import {
  PLOT_HEIGHT,
  PLOT_WIDTH,
  STACKED_AREA_PLOT_HEIGHT_CLASS,
} from "./stacked-area-geometry.ts";
import type { StackedAreaModel } from "./stacked-area-model.ts";

const bandGradientId = (m: StackedAreaModel, index: number): string => `${m.clipId}-band-${index}`;

function todayXOf(m: StackedAreaModel): number {
  return (m.win.todayFraction ?? 1) * PLOT_WIDTH;
}

function renderBands(m: StackedAreaModel, fillOpacity: number, edgeOpacity: number): ReactNode {
  return m.geometry.bands.map((band, bi) =>
    band.dot === undefined ? (
      <g key={band.key}>
        <path
          d={band.d}
          fill={`url(#${bandGradientId(m, bi)})`}
          fillOpacity={fillOpacity}
          stroke="none"
        />
        <path
          data-testid={`chart-band-edge-${band.key}`}
          d={band.edge}
          fill="none"
          stroke={band.color}
          strokeOpacity={edgeOpacity}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      </g>
    ) : (
      <circle
        key={band.key}
        data-testid="stacked-area-single-point"
        cx={PLOT_WIDTH / 2}
        cy={band.dot}
        r={SINGLE_POINT_RADIUS}
        fill={band.color}
        fillOpacity={fillOpacity}
      />
    ),
  );
}

function renderDefs(m: StackedAreaModel): ReactNode {
  const todayX = todayXOf(m);
  return (
    <defs>
      {m.geometry.bands.map((band, bi) => (
        <linearGradient key={band.key} id={bandGradientId(m, bi)} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={band.color} stopOpacity={1} />
          <stop offset="100%" stopColor={band.color} stopOpacity={0.35} />
        </linearGradient>
      ))}
      <clipPath id={`${m.clipId}-past`}>
        <rect x={0} y={0} width={todayX} height={PLOT_HEIGHT} />
      </clipPath>
      <clipPath id={`${m.clipId}-future`}>
        <rect x={todayX} y={0} width={PLOT_WIDTH - todayX} height={PLOT_HEIGHT} />
      </clipPath>
    </defs>
  );
}

function renderGridLines(m: StackedAreaModel): ReactNode {
  const { yOf, yTickValues } = m.geometry;
  return yTickValues.map((tickValue) => (
    <line
      key={tickValue}
      data-testid="chart-grid-line"
      x1={0}
      x2={PLOT_WIDTH}
      y1={yOf(tickValue)}
      y2={yOf(tickValue)}
      stroke="var(--color-border)"
      strokeWidth={1}
      strokeDasharray="3 3"
      vectorEffect="non-scaling-stroke"
    />
  ));
}

function renderMarkerGuides(m: StackedAreaModel): ReactNode {
  return m.geometry.coloredMarkers.map((marker) => {
    const x = m.win.fractionOf(marker.atMs) * PLOT_WIDTH;
    return (
      <line
        key={marker.key}
        data-testid="chart-marker-guide"
        x1={x}
        x2={x}
        y1={0}
        y2={PLOT_HEIGHT}
        stroke={marker.color}
        strokeWidth={1}
        strokeDasharray="2 3"
        vectorEffect="non-scaling-stroke"
      />
    );
  });
}

function renderLinePaths(m: StackedAreaModel): ReactNode {
  return m.geometry.linePaths.map((line) => (
    <path
      key={line.key}
      data-testid={`chart-line-${line.key}`}
      d={line.d}
      fill="none"
      stroke={line.color}
      strokeWidth={2}
      strokeDasharray={line.dashed ? "6 4" : undefined}
      vectorEffect="non-scaling-stroke"
    />
  ));
}

function renderTodayLine(m: StackedAreaModel): ReactNode {
  const todayX = todayXOf(m);
  return (
    <line
      data-testid="chart-today-line"
      x1={todayX}
      x2={todayX}
      y1={0}
      y2={PLOT_HEIGHT}
      stroke="var(--color-foreground)"
      strokeWidth={1}
      strokeDasharray="3 3"
      vectorEffect="non-scaling-stroke"
    />
  );
}

export function renderPlotSvg(m: StackedAreaModel): ReactNode {
  const { clipId } = m;
  const hasToday = m.win.todayFraction !== undefined;
  const ariaLabel = m.props.ariaLabel;
  return (
    <svg
      viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`}
      preserveAspectRatio="none"
      className={cn("block w-full", STACKED_AREA_PLOT_HEIGHT_CLASS)}
      role="img"
      aria-label={ariaLabel}
    >
      <title>{ariaLabel}</title>
      {renderDefs(m)}
      {renderGridLines(m)}
      <g clipPath={`url(#${clipId}-past)`}>{renderBands(m, 0.55, 0.9)}</g>
      {hasToday && (
        <g data-testid="chart-forecast-region" clipPath={`url(#${clipId}-future)`}>
          {renderBands(m, 0.25, 0.5)}
        </g>
      )}
      {renderMarkerGuides(m)}
      {renderLinePaths(m)}
      {hasToday && renderTodayLine(m)}
    </svg>
  );
}
