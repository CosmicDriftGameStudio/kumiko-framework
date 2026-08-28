import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import { Maximize2Icon, Minimize2Icon } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { clamp } from "../lib/clamp";
import { cn } from "../lib/cn";
import { useIsNarrowViewport } from "../primitives/use-narrow-viewport";
import { Sheet, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "../ui/sheet";
import { DrawerSheetContent } from "./sheet-parts";

// Mirrors primitives/index.tsx's cardFooter + cardFooterBorder (row layout,
// end-justified actions, top border, panel surface instead of the card
// footer's bg-muted/30) — those two consts aren't exported, so the
// equivalent classes are inlined here rather than growing the vendored
// SheetFooter's own default className with panel-specific styling.
const DRAWER_FOOTER_CLASS =
  "flex-row items-center justify-end border-t bg-background px-[var(--card-padding)] py-4";

export type DrawerProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly side?: "left" | "right" | "top" | "bottom";
  readonly title?: ReactNode;
  readonly description?: ReactNode;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
  readonly testId?: string;
  /** Header close (X). Default `true`. Turn off when the caller's own
   *  footer already has a dedicated close/cancel action, so there is only
   *  one way to dismiss the drawer. */
  readonly showCloseButton?: boolean;
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

function defaultWidthFromViewport(): number {
  return typeof window === "undefined"
    ? DEFAULT_WIDTH_MIN_PX
    : Math.max(DEFAULT_WIDTH_MIN_PX, Math.round(window.innerWidth * DEFAULT_WIDTH_VIEWPORT_RATIO));
}

// 32px margin + 32px radius so the panel reads as detached from the
// viewport edge, unlike the sheet primitive's flush-edge default. Below the
// narrow-viewport breakpoint the floating treatment doesn't fit — the JS
// hook decides, not a `sm:` Tailwind prefix, since the resize width below
// already comes from JS and two decision sources is the bug this avoids.
function floatingSideClass(side: "left" | "right" | "top" | "bottom", narrow: boolean): string {
  if (narrow) return "inset-0 h-full w-full max-w-none rounded-none border-0 overflow-hidden";
  switch (side) {
    case "left":
      return "inset-y-8 left-8 h-auto w-[max(600px,37.5vw)] max-w-[85vw] sm:max-w-[max(600px,37.5vw)] rounded-[2rem] border shadow-2xl overflow-hidden";
    case "top":
      return "inset-x-8 top-8 h-auto max-h-[80vh] rounded-[2rem] border shadow-2xl overflow-hidden";
    case "bottom":
      return "inset-x-8 bottom-8 h-auto max-h-[80vh] rounded-[2rem] border shadow-2xl overflow-hidden";
    default:
      return "inset-y-8 right-8 h-auto w-[max(600px,37.5vw)] max-w-[85vw] sm:max-w-[max(600px,37.5vw)] rounded-[2rem] border shadow-2xl overflow-hidden";
  }
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
  showCloseButton = true,
  resize,
  backdrop,
}: DrawerProps): ReactNode {
  const t = useTranslation();
  const narrow = useIsNarrowViewport();
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
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { startX: event.clientX, startWidth: effectiveWidthPx };
    setMaximized(false);
    // Handle already carries `cursor-col-resize`, so only the text-selection
    // lock is needed here — without it, a fast drag over the drawer content
    // selects the text underneath instead of just resizing.
    document.body.style.setProperty("user-select", "none");
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
    document.body.style.removeProperty("user-select");
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
      <DrawerSheetContent
        side={side}
        data-testid={testId}
        overlayStyle={overlayStyle}
        showCloseButton={showCloseButton}
        className={floatingSideClass(side, narrow)}
        style={canResize && !narrow ? { width: effectiveWidthPx, maxWidth: "none" } : undefined}
      >
        {canResize && !narrow && (
          <button
            type="button"
            onClick={() => setMaximized((m) => !m)}
            aria-pressed={maximized}
            aria-label={
              maximized ? t("kumiko.widget.drawer.restore") : t("kumiko.widget.drawer.maximize")
            }
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
        {footer !== undefined && (
          <SheetFooter className={DRAWER_FOOTER_CLASS}>{footer}</SheetFooter>
        )}
        {canResize && !narrow && (
          // biome-ignore lint/a11y/useSemanticElements: <hr> can't carry pointer/keyboard drag interaction or a live width value — a draggable separator needs a div with the ARIA role.
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t("kumiko.widget.drawer.resize")}
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
      </DrawerSheetContent>
    </Sheet>
  );
}
