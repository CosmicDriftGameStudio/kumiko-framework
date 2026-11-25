// Bare content shell for hosting self-contained widgets (own submit/cancel
// buttons) in a slide-in side panel — same "no footer buttons of its own"
// contract as DefaultModal, delegating to the richer widgets/drawer.tsx
// Drawer (resize/backdrop/side are widget-only concerns, not exposed
// through the platform-neutral CorePrimitives.Drawer contract).

import { ArrowLeftIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { DrawerProps } from "../../index.ts";
import { useTranslation } from "../../index.ts";
import { cn } from "../lib/cn.ts";
import { SheetTitle } from "../ui/sheet.tsx";
import { Drawer } from "../widgets/drawer.tsx";

const DRAWER_DIM_PERCENT = 32;
// The widget caps any explicit width at 85vw, so a phone-sized window keeps a usable panel.
const WIDE_DRAWER_WIDTH_PX = 1280;
const ICON_BUTTON_CLASS =
  "flex size-8 items-center justify-center rounded-md text-foreground-secondary hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden";
const PANEL_CLASS = "bg-background border-border-strong shadow-[-12px_0_32px_rgb(0_0_0/0.14)]";
// 24px to every viewport edge; the `max-w-none` pair lifts the side panel's 85vw / sm cap.
const POPUP_PANEL_CLASS =
  "inset-6 h-auto w-auto max-w-none sm:max-w-none rounded-xl border border-border-strong bg-card shadow-2xl";

function DrawerCloseButton({
  onClose,
  className,
}: {
  readonly onClose: () => void;
  readonly className?: string;
}): ReactNode {
  const t = useTranslation();
  return (
    <button
      type="button"
      aria-label={t("kumiko.dialog.close")}
      onClick={onClose}
      className={cn(ICON_BUTTON_CLASS, className)}
    >
      <XIcon className="size-4" />
    </button>
  );
}

function DrawerHeader({
  title,
  subtitle,
  hasBack,
  onClose,
  testId,
}: {
  readonly title: string | undefined;
  readonly subtitle: string | undefined;
  readonly hasBack: boolean;
  readonly onClose: () => void;
  readonly testId: string | undefined;
}): ReactNode {
  const t = useTranslation();
  return (
    <div
      data-testid={testId !== undefined ? `${testId}-header` : undefined}
      className={cn(
        "flex min-h-14 shrink-0 items-center gap-3 border-b border-border py-2 pr-3",
        hasBack ? "pl-3" : "pl-6",
      )}
    >
      {hasBack && (
        <button
          type="button"
          aria-label={t("kumiko.actions.back")}
          onClick={onClose}
          className={ICON_BUTTON_CLASS}
        >
          <ArrowLeftIcon className="size-4" />
        </button>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <SheetTitle className="text-base font-semibold">{title ?? ""}</SheetTitle>
        {subtitle !== undefined && (
          <p
            data-testid={testId !== undefined ? `${testId}-subtitle` : undefined}
            className="text-sm text-muted-foreground"
          >
            {subtitle}
          </p>
        )}
      </div>
      {!hasBack && <DrawerCloseButton onClose={onClose} />}
    </div>
  );
}

export function DefaultDrawer({
  open,
  onOpenChange,
  title,
  subtitle,
  width,
  headerless,
  onEscapeKey,
  back,
  children,
  testId,
}: DrawerProps): ReactNode {
  const close = (): void => onOpenChange(false);
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      testId={testId}
      variant="flush"
      side="right"
      {...(width === "wide" && { width: WIDE_DRAWER_WIDTH_PX })}
      backdrop={{ dimPercent: DRAWER_DIM_PERCENT }}
      showCloseButton={false}
      panelClassName={width === "popup" ? POPUP_PANEL_CLASS : PANEL_CLASS}
      {...(onEscapeKey !== undefined && {
        onEscapeKeyDown: (event: KeyboardEvent) => {
          if (onEscapeKey()) event.preventDefault();
        },
      })}
      fillBody
    >
      {headerless === true ? (
        <>
          <SheetTitle className="sr-only">{title ?? ""}</SheetTitle>
          <DrawerCloseButton onClose={close} className="absolute right-4 top-4 z-10" />
        </>
      ) : (
        <DrawerHeader
          title={title}
          subtitle={subtitle}
          hasBack={back === true}
          onClose={close}
          testId={testId}
        />
      )}
      {/* React re-parents portal content into the enclosing React tree for event bubbling (it only
         escapes the DOM tree, not the fiber tree) — without stopping it here, submitting the
         hosted actionForm would also bubble into an ancestor <form>'s onSubmit if the drawer was
         opened from inside one (same fix as DefaultModal). */}
      <div
        data-testid={testId !== undefined ? `${testId}-body` : undefined}
        onSubmit={(e) => e.stopPropagation()}
        className="flex min-h-0 flex-1 flex-col"
      >
        {children}
      </div>
    </Drawer>
  );
}
