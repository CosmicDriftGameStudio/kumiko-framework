import type { ScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { ReactNode } from "react";
import { lastSegment, useNav, useTranslation } from "../../index.ts";
import { ActionOverflowMenu } from "../primitives/row-actions.tsx";
import { useIsNarrowViewport } from "../primitives/use-narrow-viewport.ts";
import { MobileTopBar } from "../widgets/mobile-top-bar.tsx";
import { usePageHeaderSlot } from "./page-header-slot.tsx";
import { resolveParentScreenId, screenTitleKey } from "./shell-breadcrumb.ts";
import { useShellFocused, useShellFocusMode, useShellTopbarActions } from "./shell-focus.tsx";

function wantsShellFocus(screen: ScreenDefinition): boolean {
  return (
    (screen.type === "projectionDetail" || screen.type === "entityEdit") && screen.focus === true
  );
}

function FocusedScreenFrame({
  screen,
  screens,
  children,
}: {
  readonly screen: ScreenDefinition;
  readonly screens: readonly ScreenDefinition[];
  readonly children: ReactNode;
}): ReactNode {
  useShellFocusMode();
  const focused = useShellFocused();
  const nav = useNav();
  const t = useTranslation();
  const slot = usePageHeaderSlot();
  const shortId = lastSegment(screen.id);
  const parentScreenId = resolveParentScreenId(screens, shortId);
  const shellTopbarActions = useShellTopbarActions();
  // The bar is CSS-hidden on wide viewports, where the focused shell deliberately drops the
  // app actions; mounting them there would leave hidden duplicates (same test ids) in the DOM.
  const topbarActions = useIsNarrowViewport() ? shellTopbarActions : undefined;
  const overflowItems = slot?.overflowItems ?? [];
  const hasActions = topbarActions !== undefined || overflowItems.length > 0;
  return (
    <>
      {/* Only inside a shell that hides its own header: without one the bar would double it. */}
      {focused && (
        <MobileTopBar
          label={
            parentScreenId !== undefined
              ? t(screenTitleKey(parentScreenId))
              : (slot?.recordTitle ?? slot?.title ?? t(screenTitleKey(shortId)))
          }
          back={{
            label: t("kumiko.actions.back"),
            onClick: () =>
              parentScreenId !== undefined
                ? nav.navigate({ screenId: parentScreenId })
                : window.history.back(),
          }}
          {...(hasActions && {
            actions: (
              <>
                {topbarActions}
                {overflowItems.length > 0 && (
                  <ActionOverflowMenu
                    items={overflowItems}
                    label={t("kumiko.page-header.actions")}
                    testId="mobile-top-bar-actions"
                  />
                )}
              </>
            ),
          })}
        />
      )}
      {children}
    </>
  );
}

/** Applies a screen's declarative `focus`: focused shell chrome on desktop, a MobileTopBar on phones. */
export function ScreenFocus({
  screen,
  screens,
  children,
}: {
  readonly screen: ScreenDefinition;
  readonly screens: readonly ScreenDefinition[];
  readonly children: ReactNode;
}): ReactNode {
  if (!wantsShellFocus(screen)) return children;
  return (
    <FocusedScreenFrame screen={screen} screens={screens}>
      {children}
    </FocusedScreenFrame>
  );
}
