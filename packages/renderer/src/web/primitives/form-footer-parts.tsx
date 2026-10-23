import type { CSSProperties, ReactNode } from "react";
import type { useTranslation } from "../../index.ts";
import { cn } from "../lib/cn.ts";
import { cardFooterBorder } from "./card-styles.ts";
import { NarrowPinnedFooter } from "./narrow-pinned-footer.tsx";
import { STICKY_FOOTER_SAFE_AREA_CLASS } from "./sticky-action-bar.tsx";

type Translate = ReturnType<typeof useTranslation>;

export type FormFooterModel = {
  readonly t: Translate;
  readonly testId: string | undefined;
  readonly chromeless: boolean;
  readonly stickyActions: boolean | undefined;
  readonly fillHeight: boolean | undefined;
  readonly unsavedCount: number | undefined;
  readonly railed: boolean;
  readonly pinned: boolean;
  readonly secondaryActions: ReactNode;
  readonly renderedSecondary: ReactNode;
  readonly renderedActions: ReactNode;
  readonly hasNonPrimaryOverflow: boolean;
  readonly fixedFooterStyle: CSSProperties | undefined;
};

export function unsavedStatusText(t: Translate, unsavedCount: number): string {
  if (unsavedCount === 0) return t("kumiko.form.noUnsavedChanges");
  if (unsavedCount === 1) return t("kumiko.form.unsaved.one");
  return t("kumiko.form.unsaved.other", { count: unsavedCount });
}

export function renderNarrowPinnedFooter(
  model: Pick<FormFooterModel, "t" | "testId" | "unsavedCount">,
  nodes: readonly ReactNode[],
  keyboardInset: number,
): ReactNode {
  const { t, testId, unsavedCount } = model;
  return (
    <NarrowPinnedFooter
      nodes={nodes}
      overflowLabel={
        unsavedCount !== undefined && unsavedCount > 0
          ? `${t("kumiko.list.row-actions.more")}, ${unsavedStatusText(t, unsavedCount)}`
          : t("kumiko.list.row-actions.more")
      }
      unsavedCount={unsavedCount}
      unsavedStatus={
        unsavedCount !== undefined && unsavedCount > 0
          ? unsavedStatusText(t, unsavedCount)
          : undefined
      }
      testId={testId}
      keyboardInset={keyboardInset}
    />
  );
}

export function footerRowClassName(model: FormFooterModel): string {
  const { pinned, chromeless, fillHeight, railed } = model;
  return cn(
    pinned
      ? cn(
          "flex h-14 shrink-0 items-center justify-end gap-2 border-t border-border bg-card px-6",
          !railed && "md:pl-10",
        )
      : "flex flex-col-reverse gap-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:py-4",
    !pinned && !chromeless && "px-[var(--card-padding)]",
    !pinned && !chromeless && cardFooterBorder,
    !pinned && fillHeight === true && "shrink-0",
  );
}

export function renderUnsavedStatus(model: FormFooterModel, unsavedCount: number): ReactNode {
  const { t, testId, pinned } = model;
  return (
    <div
      data-testid={testId !== undefined ? `${testId}-unsaved` : undefined}
      className={cn(
        "mr-auto flex min-w-0 items-center gap-2 text-[13px]",
        // Only the stacked (flex-col-reverse) footer moves the status above the
        // actions; the pinned single-row footer keeps it on the left.
        !pinned && "max-sm:order-last",
        unsavedCount > 0 ? "text-foreground-secondary" : "text-muted-foreground",
      )}
    >
      {unsavedCount > 0 && (
        <span className="size-1.5 shrink-0 rounded-full bg-status-active" aria-hidden="true" />
      )}
      <span className="truncate">{unsavedStatusText(t, unsavedCount)}</span>
    </div>
  );
}

export function renderSecondaryActionsGroup(model: FormFooterModel): ReactNode {
  const { testId, pinned, hasNonPrimaryOverflow, renderedSecondary } = model;
  return (
    <div
      data-testid={testId !== undefined ? `${testId}-actions-secondary` : undefined}
      className={cn(
        // min-h-11: link-variant buttons (Copy link) are h-auto and would fall
        // below the 24px touch-target minimum on narrow viewports.
        "flex flex-wrap items-center gap-2 max-sm:[&_button]:min-h-11 max-sm:[&_button]:px-2 max-sm:[&_button]:text-xs",
        pinned && hasNonPrimaryOverflow && "mr-auto",
      )}
    >
      {renderedSecondary}
    </div>
  );
}

export function renderPrimaryActionsGroup(model: FormFooterModel): ReactNode {
  const { testId, pinned, stickyActions, fixedFooterStyle, renderedActions } = model;
  return (
    <div
      data-testid={testId !== undefined ? `${testId}-actions` : undefined}
      style={fixedFooterStyle}
      className={cn(
        "flex items-center gap-2",
        pinned
          ? "shrink-0 max-md:[&>button]:min-h-11"
          : "flex-wrap max-sm:w-full max-sm:[&>button]:flex-1 max-sm:[&>button]:min-h-11 sm:ml-auto",
        // Below sm (640px): pin only the primary action to the viewport
        // bottom instead of normal flow, so a virtual keyboard shrinking
        // the viewport can't push it out of reach. `fixed`
        // escapes the card's `overflow-hidden` (only transform/filter/
        // contain ancestors trap it, confirmed against
        // AppLayout/SidebarInset — neither sets those).
        stickyActions === true &&
          !pinned &&
          cn(
            "max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-20 max-sm:bg-background max-sm:p-4 max-sm:shadow-[0_-4px_12px_-4px_rgb(0_0_0_/_0.15)]",
            STICKY_FOOTER_SAFE_AREA_CLASS,
          ),
      )}
    >
      {renderedActions}
    </div>
  );
}
