import { Maximize2Icon, Minimize2Icon } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { cn } from "../lib/cn";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet";

export type DrawerProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly side?: "left" | "right" | "top" | "bottom";
  readonly title?: ReactNode;
  readonly description?: ReactNode;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
  readonly testId?: string;
  /** Opt-in drag-to-resize + maximize toggle (left/right sides only). */
  readonly resize?: {
    readonly defaultWidthPx?: number;
    readonly minWidthPx?: number;
    readonly maxWidthPx?: number;
  };
  /** Backdrop behind the panel. A drawer exists so the content behind it
   *  stays readable, so the blur is off by default. */
  readonly backdrop?: {
    readonly blurPx?: number;
    readonly dimPercent?: number;
  };
};

const MIN_WIDTH_PX = 320;
const MAX_WIDTH_PX = 1000;
// Must match the static `max(520px,25vw)` in floatingSideClass — Tailwind's
// JIT can't read these at runtime, so the two are kept in sync by hand.
const DEFAULT_WIDTH_MIN_PX = 520;
const DEFAULT_WIDTH_VIEWPORT_RATIO = 0.25;
const DEFAULT_BLUR_PX = 0;
const DEFAULT_DIM_PERCENT = 20;

function defaultWidthFromViewport(): number {
  return typeof window === "undefined"
    ? DEFAULT_WIDTH_MIN_PX
    : Math.max(DEFAULT_WIDTH_MIN_PX, Math.round(window.innerWidth * DEFAULT_WIDTH_VIEWPORT_RATIO));
}

// Floating panel with a clearly visible margin on every edge, rounded on
// all four corners — replaces the sheet primitive's flush-to-viewport-edge
// per-side classes. twMerge resolves each utility group against the base
// (inset/width/height/border/rounding), so this fully overrides rather than
// stacking with it. 32px margin + 32px radius so the detachment from the
// viewport edge reads clearly at a glance, not just on close 1:1 inspection.
function floatingSideClass(side: "left" | "right" | "top" | "bottom"): string {
  switch (side) {
    case "left":
      return "inset-y-8 left-8 h-auto w-[max(520px,25vw)] max-w-[85vw] sm:max-w-[max(520px,25vw)] rounded-[2rem] border shadow-2xl";
    case "top":
      return "inset-x-8 top-8 h-auto max-h-[80vh] rounded-[2rem] border shadow-2xl";
    case "bottom":
      return "inset-x-8 bottom-8 h-auto max-h-[80vh] rounded-[2rem] border shadow-2xl";
    default:
      return "inset-y-8 right-8 h-auto w-[max(520px,25vw)] max-w-[85vw] sm:max-w-[max(520px,25vw)] rounded-[2rem] border shadow-2xl";
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Slide-in panel beside a list (e.g. mail reader next to the inbox) —
 *  thin wrapper over the Sheet primitive with header/body/footer slots
 *  so screens skip per-route Radix boilerplate. */
export function Drawer({
  open,
  onOpenChange,
  side = "right",
  title,
  description,
  footer,
  children,
  testId,
  resize,
  backdrop,
}: DrawerProps): ReactNode {
  const canResize = resize !== undefined && (side === "left" || side === "right");
  const minWidthPx = resize?.minWidthPx ?? MIN_WIDTH_PX;
  const maxWidthPx = resize?.maxWidthPx ?? MAX_WIDTH_PX;
  const effectiveMaxWidthPx = () =>
    typeof window === "undefined"
      ? maxWidthPx
      : Math.min(maxWidthPx, Math.round(window.innerWidth * 0.9));
  const [width, setWidth] = useState(() =>
    clamp(resize?.defaultWidthPx ?? defaultWidthFromViewport(), minWidthPx, effectiveMaxWidthPx()),
  );
  const [maximized, setMaximized] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const blurPx = backdrop?.blurPx ?? DEFAULT_BLUR_PX;
  const dimPercent = backdrop?.dimPercent ?? DEFAULT_DIM_PERCENT;
  const overlayStyle: React.CSSProperties = {
    backgroundColor: `rgb(0 0 0 / ${dimPercent}%)`,
    ...(blurPx > 0 ? { backdropFilter: `blur(${blurPx}px)` } : {}),
  };

  const effectiveWidthPx = maximized ? effectiveMaxWidthPx() : width;

  const onHandlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { startX: event.clientX, startWidth: effectiveWidthPx };
    setMaximized(false);
  };
  const onHandlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (dragRef.current === null) return;
    const deltaX = event.clientX - dragRef.current.startX;
    const signedDelta = side === "right" ? -deltaX : deltaX;
    setWidth(clamp(dragRef.current.startWidth + signedDelta, minWidthPx, effectiveMaxWidthPx()));
  };
  const onHandlePointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
  };
  const onHandleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 40 : 16;
    const grow = side === "right" ? "ArrowLeft" : "ArrowRight";
    const shrink = side === "right" ? "ArrowRight" : "ArrowLeft";
    if (event.key !== grow && event.key !== shrink) return;
    event.preventDefault();
    setMaximized(false);
    const delta = event.key === grow ? step : -step;
    // Seed from the currently visible width, not the stale `width` state —
    // while maximized, `width` still holds the pre-maximize value, so a key
    // press would otherwise jump the drawer back to that old size instead
    // of resizing relative to what's on screen.
    setWidth((current) =>
      clamp((maximized ? effectiveWidthPx : current) + delta, minWidthPx, effectiveMaxWidthPx()),
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={side}
        data-testid={testId}
        overlayStyle={overlayStyle}
        className={floatingSideClass(side)}
        style={canResize ? { width: effectiveWidthPx, maxWidth: "none" } : undefined}
      >
        {canResize && (
          <button
            type="button"
            onClick={() => setMaximized((m) => !m)}
            aria-pressed={maximized}
            aria-label={maximized ? "Restore drawer width" : "Maximize drawer width"}
            className="absolute top-4 right-14 z-10 rounded-xs p-1 text-muted-foreground opacity-70 transition-opacity hover:opacity-100 hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
          >
            {maximized ? (
              <Minimize2Icon className="size-4" />
            ) : (
              <Maximize2Icon className="size-4" />
            )}
          </button>
        )}
        {(title !== undefined || description !== undefined) && (
          <SheetHeader>
            {title !== undefined && <SheetTitle>{title}</SheetTitle>}
            {description !== undefined && <SheetDescription>{description}</SheetDescription>}
          </SheetHeader>
        )}
        <div className="flex-1 overflow-y-auto px-4">{children}</div>
        {footer !== undefined && <SheetFooter>{footer}</SheetFooter>}
        {canResize && (
          // biome-ignore lint/a11y/useSemanticElements: <hr> can't carry pointer/keyboard drag interaction or a live width value — a draggable separator needs a div with the ARIA role.
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize drawer"
            aria-valuenow={effectiveWidthPx}
            aria-valuemin={minWidthPx}
            aria-valuemax={effectiveMaxWidthPx()}
            tabIndex={0}
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
            onKeyDown={onHandleKeyDown}
            className={cn(
              "absolute inset-y-0 z-10 w-1 cursor-col-resize touch-none after:absolute after:inset-y-0 after:left-1/2 after:w-3 after:-translate-x-1/2 hover:bg-border",
              side === "right" ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2",
            )}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
