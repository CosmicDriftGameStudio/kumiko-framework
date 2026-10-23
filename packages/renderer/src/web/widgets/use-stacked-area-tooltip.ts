import { useEffect, useRef, useState } from "react";

export function useStackedAreaTooltip(times: readonly number[]) {
  const [selectedTooltipAtMs, setSelectedTooltipAtMs] = useState<number | null>(null);
  // Stored as a time, not an index: a shifted window must not retarget the card to another bucket.
  const tooltipAtMs =
    selectedTooltipAtMs !== null && times.includes(selectedTooltipAtMs)
      ? selectedTooltipAtMs
      : undefined;
  const tooltipOverlayRef = useRef<HTMLDivElement>(null);
  const touchStartRef = useRef<{ readonly x: number; readonly y: number } | null>(null);

  const isTooltipOpen = tooltipAtMs !== undefined;
  useEffect(() => {
    // skip: no tooltip card open, nothing to dismiss
    if (!isTooltipOpen) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") setSelectedTooltipAtMs(null);
    };
    const closeOnOutsidePointerDown = (event: globalThis.PointerEvent): void => {
      const overlay = tooltipOverlayRef.current;
      // skip: pointer landed inside the overlay, taps there select a bucket instead
      if (overlay !== null && event.target instanceof Node && overlay.contains(event.target))
        return;
      setSelectedTooltipAtMs(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePointerDown);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
    };
  }, [isTooltipOpen]);

  return { tooltipAtMs, setSelectedTooltipAtMs, tooltipOverlayRef, touchStartRef };
}
