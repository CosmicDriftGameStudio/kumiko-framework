import { type KeyboardEvent, type ReactNode, useRef } from "react";
import { cn } from "../lib/cn.ts";

const EQUAL_WIDTH_MAX_SEGMENTS = 4;

// WAI-ARIA radiogroup pattern (role="radiogroup" + role="radio" children):
// arrow keys move focus AND selection in the same step, only the checked
// segment (or the first when none is checked) sits in the tab order.
export function SegmentedControl({
  id,
  name,
  value,
  onChange,
  options,
  disabled,
  required,
  hasError,
  labelProps,
}: {
  readonly id: string;
  readonly name: string;
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
    readonly disabled?: boolean;
  }[];
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly hasError?: boolean;
  /** Accessible name: `aria-labelledby` into a Field label, or a plain `aria-label`. */
  readonly labelProps: { "aria-labelledby": string } | { "aria-label": string };
}): ReactNode {
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // An unknown/legacy value checks no segment; the first one must still be tabbable.
  const selectedIndex = options.findIndex((opt) => opt.value === value);
  const tabStopIndex = selectedIndex === -1 ? 0 : selectedIndex;

  const selectAt = (index: number): void => {
    const target = options[index];
    if (target === undefined) return;
    onChange(target.value);
    buttonRefs.current[index]?.focus();
  };

  // Arrow keys skip disabled segments; with none enabled they stay put.
  const nextEnabledIndex = (from: number, step: 1 | -1): number => {
    for (let hop = 1; hop <= options.length; hop++) {
      const candidate = (from + step * hop + options.length * hop) % options.length;
      if (options[candidate]?.disabled !== true) return candidate;
    }
    return from;
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      selectAt(nextEnabledIndex(index, 1));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      selectAt(nextEnabledIndex(index, -1));
    }
  };

  return (
    <div
      role="radiogroup"
      {...labelProps}
      aria-required={required}
      aria-invalid={hasError === true ? true : undefined}
      data-testid={`segmented-${id}`}
      className={cn(
        // Few segments share one row at equal width so labels wrap inside
        // their segment instead of leaving one tall and its siblings short.
        options.length <= EQUAL_WIDTH_MAX_SEGMENTS
          ? "inline-grid max-w-full grid-flow-col auto-cols-fr"
          : "inline-flex w-fit flex-wrap",
        "min-h-9 overflow-hidden rounded-md border",
        hasError === true ? "border-destructive" : "border-input",
      )}
    >
      <input type="hidden" name={name} value={value} />
      {options.map((opt, index) => {
        const checked = opt.value === value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a native <input type="radio"> can't render the segment's label as content — button+role="radio" is the standard WAI-ARIA composite-widget substitute.
          <button
            key={opt.value}
            ref={(node) => {
              buttonRefs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={index === tabStopIndex ? 0 : -1}
            disabled={disabled === true || opt.disabled === true}
            data-testid={`segmented-${id}-${opt.value}`}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className={cn(
              // Per-segment top/left border instead of the container's
              // `divide-x`: divide-x only draws verticals between siblings
              // in source order, which misplaces borders the moment a
              // segment wraps to a new row (stray left border on the first
              // item of row 2, no line between the rows). The -1px margin
              // collapses each segment's own border onto its neighbour's —
              // for row/column edges it overlaps the container's border
              // instead, clipped by the container's `overflow-hidden`.
              //
              // `grow` lets segments share leftover space on a wrapped row
              // so every row spans the container's full (widest-row) width —
              // without it, a shorter last row left its right edge borderless
              // and the next row's top border cut a notch into the row above.
              // Harmless on a single-row layout: there's no leftover space to
              // grow into, so `w-fit` on the container still holds.
              "-ml-px -mt-px grow border-l border-t px-3 py-1.5 text-center text-sm transition-colors",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-50",
              hasError === true ? "border-destructive/50" : "border-border",
              checked
                ? "bg-primary/10 font-semibold text-primary"
                : "bg-transparent font-medium text-foreground hover:bg-accent",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
