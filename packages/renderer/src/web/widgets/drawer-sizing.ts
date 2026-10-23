import type { CSSProperties } from "react";
import { MAX_VIEWPORT_WIDTH } from "./drawer-panel-class.ts";

export const MIN_WIDTH_PX = 320;
export const MAX_WIDTH_PX = 1000;
// Must match the static `max(600px,37.5vw)` in floatingSideClass — Tailwind's
// JIT can't read these at runtime, so the two are kept in sync by hand.
// 600px (vs. the old 520px floor) gives a two-column field row (e.g.
// street/number, zip/city) room to breathe, while staying well under half
// of a 1280px viewport so a narrow window isn't dominated by the drawer.
// 37.5vw (vs. the old 25vw) keeps that same 600px on a 1280–1600px window
// (25vw was still under the floor there, making the ratio dead weight up
// to 2400px) but actually grows past the floor by ~1600px, so a 1920px
// window — where the two-column row is cramped just as often — lands
// around 720px instead of being stuck at 600px alongside a 1280px window.
const DEFAULT_WIDTH_MIN_PX = 600;
const DEFAULT_WIDTH_VIEWPORT_RATIO = 0.375;
const DEFAULT_BLUR_PX = 0;
const DEFAULT_DIM_PERCENT = 20;

export function defaultWidthFromViewport(): number {
  return typeof window === "undefined"
    ? DEFAULT_WIDTH_MIN_PX
    : Math.max(DEFAULT_WIDTH_MIN_PX, Math.round(window.innerWidth * DEFAULT_WIDTH_VIEWPORT_RATIO));
}

function normalizeWidth(width: number | string): string {
  return typeof width === "number" ? `${width}px` : width;
}

export function buildOverlayStyle(
  backdrop:
    | {
        readonly blurPx?: number;
        readonly dimPercent?: number;
      }
    | undefined,
): CSSProperties {
  const blurPx = backdrop?.blurPx ?? DEFAULT_BLUR_PX;
  const dimPercent = backdrop?.dimPercent ?? DEFAULT_DIM_PERCENT;
  return {
    backgroundColor: `rgb(0 0 0 / ${dimPercent}%)`,
    ...(blurPx > 0 ? { backdropFilter: `blur(${blurPx}px)` } : {}),
  };
}

type SheetStyleInput = {
  readonly side: "left" | "right" | "top" | "bottom";
  readonly narrow: boolean;
  readonly canResize: boolean;
  readonly width: number | string | undefined;
  readonly effectiveWidthPx: number;
  readonly variant: "floating" | "flush";
  readonly belowHeader: boolean;
};

function isHorizontalSide(side: SheetStyleInput["side"]): boolean {
  return side === "left" || side === "right";
}

function customWidthStyleOf(input: SheetStyleInput): CSSProperties | undefined {
  const { side, narrow, canResize, width } = input;
  return !canResize && !narrow && isHorizontalSide(side) && width !== undefined
    ? { width: normalizeWidth(width), maxWidth: MAX_VIEWPORT_WIDTH }
    : undefined;
}

// Inline style because tailwind-merge doesn't dedupe `top-*`/`bottom-*` against the base `inset-y-0`;
// style wins over class regardless of generated CSS order.
function verticalOffsetStyleOf(input: SheetStyleInput): CSSProperties | undefined {
  const { side, narrow, variant, belowHeader } = input;
  return belowHeader && variant === "flush" && !narrow && isHorizontalSide(side)
    ? { top: "var(--shell-header-height)", bottom: 0 }
    : undefined;
}

export function buildSheetStyle(input: SheetStyleInput): CSSProperties | undefined {
  const { narrow, canResize, effectiveWidthPx } = input;
  const verticalOffsetStyle = verticalOffsetStyleOf(input);
  const widthStyle =
    canResize && !narrow
      ? { width: effectiveWidthPx, maxWidth: "none" }
      : customWidthStyleOf(input);
  return widthStyle === undefined && verticalOffsetStyle === undefined
    ? undefined
    : { ...widthStyle, ...verticalOffsetStyle };
}
