import { clamp } from "../lib/clamp.ts";
import type { DragDelta } from "./use-pointer-drag.ts";

export type FloatingPanelGeometry = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type Edge = "top" | "right" | "bottom" | "left";

export const FLOATING_PANEL_MARGIN_PX = 24;
// Minimum distance to every viewport edge, so the panel never sticks to the window border.
const VIEWPORT_GAP_PX = 16;
const DEFAULT_MIN_WIDTH_PX = 280;
const DEFAULT_MIN_HEIGHT_PX = 200;

export type Limits = {
  readonly minWidth: number;
  readonly minHeight: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
};

type LimitOptions = {
  readonly minWidthPx?: number | undefined;
  readonly minHeightPx?: number | undefined;
  readonly maxWidthPx?: number | undefined;
  readonly maxHeightPx?: number | undefined;
};

export function readLimits(options: LimitOptions): Limits {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const maxWidth = Math.min(
    options.maxWidthPx ?? viewportWidth - 2 * FLOATING_PANEL_MARGIN_PX,
    viewportWidth - 2 * VIEWPORT_GAP_PX,
  );
  const maxHeight = Math.min(
    options.maxHeightPx ?? viewportHeight - 2 * FLOATING_PANEL_MARGIN_PX,
    viewportHeight - 2 * VIEWPORT_GAP_PX,
  );
  return {
    // A viewport smaller than the configured minimum wins: the panel must stay fully visible.
    minWidth: Math.min(options.minWidthPx ?? DEFAULT_MIN_WIDTH_PX, maxWidth),
    minHeight: Math.min(options.minHeightPx ?? DEFAULT_MIN_HEIGHT_PX, maxHeight),
    maxWidth,
    maxHeight,
    viewportWidth,
    viewportHeight,
  };
}

// Size first, then position, so a shrunk panel is placed against its final size.
export function fitGeometry(
  geometry: FloatingPanelGeometry,
  limits: Limits,
): FloatingPanelGeometry {
  const width = clamp(geometry.width, limits.minWidth, limits.maxWidth);
  const height = clamp(geometry.height, limits.minHeight, limits.maxHeight);
  return {
    width,
    height,
    x: clampIntoViewport(geometry.x, width, limits.viewportWidth),
    y: clampIntoViewport(geometry.y, height, limits.viewportHeight),
  };
}

function clampIntoViewport(position: number, size: number, viewportSize: number): number {
  return clamp(
    position,
    VIEWPORT_GAP_PX,
    Math.max(VIEWPORT_GAP_PX, viewportSize - size - VIEWPORT_GAP_PX),
  );
}

export type ViewportSize = { readonly width: number; readonly height: number };

// A panel closer to the right (bottom) edge keeps its distance to that edge when the window
// changes size; otherwise it keeps its distance to the left (top) edge.
function anchoredPosition(
  position: number,
  size: number,
  previousViewportSize: number,
  fittedSize: number,
  viewportSize: number,
): number {
  const endGap = previousViewportSize - (position + size);
  return endGap < position ? viewportSize - fittedSize - endGap : position;
}

export function refitToViewport(
  geometry: FloatingPanelGeometry,
  previousViewport: ViewportSize,
  limits: Limits,
): FloatingPanelGeometry {
  const sized = fitGeometry(geometry, limits);
  return fitGeometry(
    {
      ...sized,
      x: anchoredPosition(
        geometry.x,
        geometry.width,
        previousViewport.width,
        sized.width,
        limits.viewportWidth,
      ),
      y: anchoredPosition(
        geometry.y,
        geometry.height,
        previousViewport.height,
        sized.height,
        limits.viewportHeight,
      ),
    },
    limits,
  );
}

type Axis = { readonly position: number; readonly size: number };

// The edge being dragged follows the pointer; the opposite edge stays put.
function resizeAxis(
  start: Axis,
  delta: number,
  movesStartEdge: boolean,
  min: number,
  max: number,
  viewportSize: number,
): Axis {
  if (movesStartEdge) {
    const end = start.position + start.size;
    const size = clamp(start.size - delta, min, Math.min(max, end - VIEWPORT_GAP_PX));
    return { position: end - size, size };
  }
  const size = clamp(
    start.size + delta,
    min,
    Math.min(max, viewportSize - VIEWPORT_GAP_PX - start.position),
  );
  return { position: start.position, size };
}

export function resizeGeometry(
  start: FloatingPanelGeometry,
  edges: readonly Edge[],
  delta: DragDelta,
  limits: Limits,
): FloatingPanelGeometry {
  let { x, y, width, height } = start;
  for (const edge of edges) {
    if (edge === "left" || edge === "right") {
      ({ position: x, size: width } = resizeAxis(
        { position: start.x, size: start.width },
        delta.dx,
        edge === "left",
        limits.minWidth,
        limits.maxWidth,
        limits.viewportWidth,
      ));
    } else {
      ({ position: y, size: height } = resizeAxis(
        { position: start.y, size: start.height },
        delta.dy,
        edge === "top",
        limits.minHeight,
        limits.maxHeight,
        limits.viewportHeight,
      ));
    }
  }
  return { x, y, width, height };
}
