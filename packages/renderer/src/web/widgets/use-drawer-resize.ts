import { type KeyboardEvent, useState } from "react";
import { clamp } from "../lib/clamp.ts";
import { defaultWidthFromViewport, MAX_WIDTH_PX, MIN_WIDTH_PX } from "./drawer-sizing.ts";
import { arrowKeyDelta, usePointerDrag } from "./use-pointer-drag.ts";

export type DrawerResizeConfig = {
  readonly defaultWidthPx?: number;
  readonly minWidthPx?: number;
  readonly maxWidthPx?: number;
};

export type DrawerResizeState = {
  readonly minWidthPx: number;
  readonly resizedWidthPx: number;
  readonly setResizedWidthPx: (update: number | ((current: number) => number)) => void;
  readonly maximized: boolean;
  readonly setMaximized: (update: boolean | ((current: boolean) => boolean)) => void;
  readonly effectiveWidthPx: number;
  readonly effectiveMaxWidthPx: () => number;
};

export function useDrawerResizeState(resize: DrawerResizeConfig | undefined): DrawerResizeState {
  const minWidthPx = resize?.minWidthPx ?? MIN_WIDTH_PX;
  const maxWidthPx = resize?.maxWidthPx ?? MAX_WIDTH_PX;
  const effectiveMaxWidthPx = () =>
    typeof window === "undefined"
      ? maxWidthPx
      : Math.min(maxWidthPx, Math.round(window.innerWidth * 0.9));
  const [resizedWidthPx, setResizedWidthPx] = useState(() =>
    clamp(resize?.defaultWidthPx ?? defaultWidthFromViewport(), minWidthPx, effectiveMaxWidthPx()),
  );
  const [maximized, setMaximized] = useState(false);
  const effectiveWidthPx = maximized ? effectiveMaxWidthPx() : resizedWidthPx;
  return {
    minWidthPx,
    resizedWidthPx,
    setResizedWidthPx,
    maximized,
    setMaximized,
    effectiveWidthPx,
    effectiveMaxWidthPx,
  };
}

export type DrawerResizeHandle = {
  readonly handleDrag: ReturnType<typeof usePointerDrag>;
  readonly onHandleKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
};

export function useDrawerResizeHandle(
  side: "left" | "right" | "top" | "bottom",
  resize: DrawerResizeState,
): DrawerResizeHandle {
  const { minWidthPx, setResizedWidthPx, maximized, setMaximized, effectiveWidthPx } = resize;
  const { effectiveMaxWidthPx } = resize;
  const handleDrag = usePointerDrag({
    onStart: () => {
      setMaximized(false);
      return { startWidth: effectiveWidthPx };
    },
    onMove: ({ startWidth }, { dx }) => {
      const signedDelta = side === "right" ? -dx : dx;
      setResizedWidthPx(clamp(startWidth + signedDelta, minWidthPx, effectiveMaxWidthPx()));
    },
  });
  const onHandleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const keyDelta = arrowKeyDelta(event);
    // skip: only horizontal arrow keys resize the drawer
    if (keyDelta === undefined || keyDelta.dx === 0) return;
    event.preventDefault();
    setMaximized(false);
    const delta = side === "right" ? -keyDelta.dx : keyDelta.dx;
    // Seed from the currently visible width, not the stale `resizedWidthPx`
    // state — while maximized, it still holds the pre-maximize value, so a
    // key press would otherwise jump the drawer back to that old size
    // instead of resizing relative to what's on screen.
    setResizedWidthPx((current) =>
      clamp((maximized ? effectiveWidthPx : current) + delta, minWidthPx, effectiveMaxWidthPx()),
    );
  };
  return { handleDrag, onHandleKeyDown };
}
