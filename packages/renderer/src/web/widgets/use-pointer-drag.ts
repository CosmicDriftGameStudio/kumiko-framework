import { type KeyboardEvent, type PointerEvent, useRef } from "react";

export type DragDelta = { readonly dx: number; readonly dy: number };

type PointerDragOptions<TStart> = {
  readonly onStart: (event: PointerEvent<HTMLElement>) => TStart;
  readonly onMove: (start: TStart, delta: DragDelta) => void;
  readonly onEnd?: () => void;
};

type PointerDragHandlers = {
  readonly onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  readonly onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
  readonly onLostPointerCapture: (event: PointerEvent<HTMLElement>) => void;
};

type ActiveDrag<TStart> = {
  readonly startX: number;
  readonly startY: number;
  readonly start: TStart;
};

export function usePointerDrag<TStart>({
  onStart,
  onMove,
  onEnd,
}: PointerDragOptions<TStart>): PointerDragHandlers {
  const dragRef = useRef<ActiveDrag<TStart> | null>(null);

  const onPointerDown = (event: PointerEvent<HTMLElement>): void => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { startX: event.clientX, startY: event.clientY, start: onStart(event) };
    // Without the lock a fast drag selects the text underneath instead of just dragging.
    document.body.style.setProperty("user-select", "none");
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>): void => {
    const drag = dragRef.current;
    if (drag !== null) {
      onMove(drag.start, { dx: event.clientX - drag.startX, dy: event.clientY - drag.startY });
    }
  };
  const endDrag = (event: PointerEvent<HTMLElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const wasDragging = dragRef.current !== null;
    dragRef.current = null;
    document.body.style.removeProperty("user-select");
    // pointerup and the lostpointercapture it triggers both land here; only the first ends a drag.
    if (wasDragging) onEnd?.();
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onLostPointerCapture: endDrag,
  };
}

const KEY_STEP_PX = 16;
const KEY_STEP_SHIFT_PX = 40;

/** Arrow keys as a pixel delta (Shift = larger step); undefined for any other key. */
export function arrowKeyDelta(event: KeyboardEvent<HTMLElement>): DragDelta | undefined {
  const step = event.shiftKey ? KEY_STEP_SHIFT_PX : KEY_STEP_PX;
  switch (event.key) {
    case "ArrowLeft":
      return { dx: -step, dy: 0 };
    case "ArrowRight":
      return { dx: step, dy: 0 };
    case "ArrowUp":
      return { dx: 0, dy: -step };
    case "ArrowDown":
      return { dx: 0, dy: step };
    default:
      return undefined;
  }
}
