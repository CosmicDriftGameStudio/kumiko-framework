import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "../../index.ts";
import { cn } from "../lib/cn.ts";
import { useIsNarrowViewport } from "../primitives/use-narrow-viewport.ts";
import { Sheet, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "../ui/sheet.tsx";
import { sidePanelClass } from "./drawer-panel-class.ts";
import { renderMaximizeButton, renderResizeHandle } from "./drawer-resize-controls.tsx";
import { buildOverlayStyle, buildSheetStyle } from "./drawer-sizing.ts";
import { DrawerSheetContent } from "./sheet-parts.tsx";
import { useDrawerResizeHandle, useDrawerResizeState } from "./use-drawer-resize.ts";

// Mirrors primitives/index.tsx's cardFooter + cardFooterBorder (row layout,
// end-justified actions, top border, panel surface instead of the card
// footer's bg-muted/30) — those two consts aren't exported, so the
// equivalent classes are inlined here rather than growing the vendored
// SheetFooter's own default className with panel-specific styling.
const DRAWER_FOOTER_CLASS =
  "flex-row flex-wrap items-center justify-end border-t bg-background px-[var(--card-padding)] py-4";

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
  /** Panel treatment. `"flush"` (default) docks the panel against the edge —
   *  full extent, no radius, and a border only on the edge facing the app
   *  content. `"floating"` gives the detached-panel look (margin to the
   *  viewport edge, full corner radius). Ignored in the narrow-viewport
   *  fullscreen layout. */
  readonly variant?: "floating" | "flush";
  /** `variant="flush"` only: dock the panel below the app's ShellHeader
   *  (offset top by `--shell-header-height`, height shrunk to match)
   *  instead of covering it. Default `false` is edge-to-edge. No ShellHeader
   *  mounted → the variable is `0`, so this is a no-op. Ignored in the
   *  narrow-viewport fullscreen layout, which already takes over the whole
   *  screen including the header. */
  readonly belowHeader?: boolean;
  /** Panel width for `side="left"|"right"` (ignored for top/bottom and in
   *  the narrow-viewport layout). A number is pixels, a string any CSS
   *  length. Superseded by `resize` when that's set. Default matches the
   *  panel's built-in `max(600px, 37.5vw)`. */
  readonly width?: number | string;
  /** Opt-in drag-to-resize + maximize toggle (left/right sides only). */
  readonly resize?: {
    readonly defaultWidthPx?: number;
    readonly minWidthPx?: number;
    readonly maxWidthPx?: number;
  };
  /** Backdrop behind the panel. A drawer exists so the content behind it
   *  stays readable, so the blur is off by default. Ignored when
   *  `modal={false}` — there is no overlay to style then. */
  readonly backdrop?: {
    readonly blurPx?: number;
    readonly dimPercent?: number;
  };
  /** `false` runs the drawer as a panel beside the page instead of over it:
   *  no overlay, no focus trap, and the page behind stays interactive, so
   *  text there can be selected and copied. Escape closes in both modes, a
   *  click beside the panel only in the modal one — the non-modal case
   *  exists to be used next to the page content, where a stray click must
   *  not dismiss it. With `showCloseButton={false}` and no footer action
   *  that leaves Escape as the only way out, so keep one of the two.
   *  Default `true`. */
  readonly modal?: boolean;
  /** Extra classes for the panel, merged over the built-in ones. Not applied
   *  in the narrow-viewport fullscreen layout. */
  readonly panelClassName?: string;
  /** The body becomes a plain flex column with no padding or scrolling of its
   *  own, for children that bring their own scroll area and pinned footer. */
  readonly fillBody?: boolean;
};

const DRAWER_INSET_PROPERTY = {
  left: "--kumiko-drawer-inset-left",
  right: "--kumiko-drawer-inset-right",
} as const;

// Publishes the width a non-modal side drawer occupies so the shell content (styles.css) can
// narrow instead of sitting underneath it. Read from the layout box (offsetLeft/offsetWidth), not
// getBoundingClientRect: the slide-in animation moves the painted rect, and the observer would
// not fire again once it settles.
// ponytail: one owner per side, so two non-modal drawers open on the same side overwrite each
// other's value; a registry that takes the max is needed once a screen stacks them.
function usePublishDrawerInset(
  sheet: HTMLElement | null,
  side: "left" | "right" | "top" | "bottom",
  active: boolean,
): void {
  useEffect(() => {
    if (!active || sheet === null || (side !== "left" && side !== "right")) return;
    const property = DRAWER_INSET_PROPERTY[side];
    const root = document.documentElement;
    const publish = (): void => {
      const inset =
        side === "right"
          ? window.innerWidth - sheet.offsetLeft
          : sheet.offsetLeft + sheet.offsetWidth;
      root.style.setProperty(property, `${Math.max(0, Math.round(inset))}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(sheet);
    window.addEventListener("resize", publish);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", publish);
      root.style.removeProperty(property);
    };
  }, [sheet, side, active]);
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
  variant = "flush",
  belowHeader = false,
  width,
  resize,
  backdrop,
  modal = true,
  panelClassName,
  fillBody = false,
}: DrawerProps): ReactNode {
  const t = useTranslation();
  const narrow = useIsNarrowViewport();
  const canResize = resize !== undefined && (side === "left" || side === "right");
  const resizeState = useDrawerResizeState(resize);
  const [sheet, setSheet] = useState<HTMLElement | null>(null);
  usePublishDrawerInset(sheet, side, open && !modal && !narrow);
  const overlayStyle = buildOverlayStyle(backdrop);
  const sheetStyle = buildSheetStyle({
    side,
    narrow,
    canResize,
    width,
    effectiveWidthPx: resizeState.effectiveWidthPx,
    variant,
    belowHeader,
  });
  const handle = useDrawerResizeHandle(side, resizeState);
  const resizeControls = { t, side, resize: resizeState, handle };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={modal}>
      <DrawerSheetContent
        ref={setSheet}
        side={side}
        data-testid={testId}
        overlayStyle={overlayStyle}
        // Radix already drops the overlay and the focus trap for a
        // non-modal Root; only the dismiss-on-outside-interaction is left
        // to suppress, so a click into the page behind keeps the panel open.
        onInteractOutside={modal ? undefined : (event) => event.preventDefault()}
        showCloseButton={showCloseButton}
        closeLabel={t("kumiko.dialog.close")}
        className={cn(
          sidePanelClass(side, narrow, variant, belowHeader),
          fillBody && "gap-0",
          !narrow && panelClassName,
        )}
        style={sheetStyle}
      >
        {canResize && !narrow && renderMaximizeButton(resizeControls)}
        {(title !== undefined || description !== undefined) && (
          <SheetHeader>
            {title !== undefined && <SheetTitle>{title}</SheetTitle>}
            {description !== undefined && <SheetDescription>{description}</SheetDescription>}
          </SheetHeader>
        )}
        <div className={fillBody ? "flex min-h-0 flex-1 flex-col" : "flex-1 overflow-y-auto px-4"}>
          {children}
        </div>
        {footer !== undefined && (
          <SheetFooter className={DRAWER_FOOTER_CLASS}>{footer}</SheetFooter>
        )}
        {canResize && !narrow && renderResizeHandle(resizeControls)}
      </DrawerSheetContent>
    </Sheet>
  );
}
