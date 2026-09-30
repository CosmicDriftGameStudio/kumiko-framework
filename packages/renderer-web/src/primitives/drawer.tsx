// Bare content shell for hosting self-contained widgets (own submit/cancel
// buttons) in a slide-in side panel — same "no footer buttons of its own"
// contract as DefaultModal, delegating to the richer widgets/drawer.tsx
// Drawer (resize/backdrop/side are widget-only concerns, not exposed
// through the platform-neutral CorePrimitives.Drawer contract).

import type { DrawerProps } from "@cosmicdrift/kumiko-renderer";
import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import { XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { SheetTitle } from "../ui/sheet";
import { Drawer } from "../widgets/drawer";

const DRAWER_WIDTH_PX = 480;
const DRAWER_DIM_PERCENT = 32;
const PANEL_CLASS = "bg-card border-border-strong shadow-[-12px_0_32px_rgb(0_0_0/0.14)]";

export function DefaultDrawer({
  open,
  onOpenChange,
  title,
  children,
  testId,
}: DrawerProps): ReactNode {
  const t = useTranslation();
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      testId={testId}
      variant="flush"
      side="right"
      width={DRAWER_WIDTH_PX}
      backdrop={{ dimPercent: DRAWER_DIM_PERCENT }}
      showCloseButton={false}
      panelClassName={PANEL_CLASS}
      fillBody
    >
      <div
        data-testid={testId !== undefined ? `${testId}-header` : undefined}
        className="flex h-14 shrink-0 items-center gap-3 border-b border-border pr-3 pl-6"
      >
        <SheetTitle className="flex-1 text-base font-semibold">{title ?? ""}</SheetTitle>
        <button
          type="button"
          aria-label={t("kumiko.dialog.close")}
          onClick={() => onOpenChange(false)}
          className="flex size-8 items-center justify-center rounded-md text-foreground-secondary hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
        >
          <XIcon className="size-4" />
        </button>
      </div>
      {/* React re-parents portal content into the enclosing React tree for
          event bubbling (it only escapes the DOM tree, not the fiber tree) —
          without stopping it here, submitting the hosted actionForm would
          also bubble into an ancestor <form>'s onSubmit if the drawer was
          opened from inside one (same fix as DefaultModal, fw#1681). */}
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
