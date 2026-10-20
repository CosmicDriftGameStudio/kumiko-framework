import type { ReactNode } from "react";
import { RenderEditActionButton } from "../components/render-edit-action-button.tsx";
import type { RenderEditAction } from "../components/render-edit-types.ts";
import { useActionMenuItems } from "../components/use-action-menu-items.tsx";
import { useTranslation } from "../i18n.tsx";
import type { usePrimitives } from "../primitives.tsx";
import type { ErrorNotice } from "./error-reference.tsx";
import {
  compactHeaderPrimary,
  orderPlainHeaderActions,
  primaryHeaderAction,
} from "./header-actions.ts";

// Header actions bar (A7): <=2 actions render as plain buttons; >2 with an
// `ActionOverflowMenu` primitive collapse to the primary button plus a menu
// for the rest — same rule as RowActionsCell for table rows. Owns confirm
// state for menu items: RenderEditActionButton already owns a per-button
// confirm dialog for the always-visible primary action, but a menu item has
// no button of its own to carry one.
export function HeaderActionsBar({
  actions,
  Button,
  Dialog,
  ActionOverflowMenu,
  onError,
  collapseAfterPrimary = false,
  compact = false,
  preferredPrimaryId,
  PageHeader,
  overflowTestId = "kumiko-screen-projection-detail-actions-overflow",
}: {
  /** `primaryAction` of the screen: wins over the edit/primary-style precedence. */
  readonly preferredPrimaryId?: string;
  /** Header slot layout: only the primary action stays a button, the rest goes into the menu. */
  readonly collapseAfterPrimary?: boolean;
  /** Phone-width shell header: an icon-only primary button, the rest in the shell's overflow menu. */
  readonly compact?: boolean;
  readonly PageHeader?: ReturnType<typeof usePrimitives>["PageHeader"];
  readonly actions: readonly RenderEditAction[];
  readonly Button: ReturnType<typeof usePrimitives>["Button"];
  readonly Dialog: ReturnType<typeof usePrimitives>["Dialog"];
  readonly ActionOverflowMenu: ReturnType<typeof usePrimitives>["ActionOverflowMenu"];
  readonly onError: (notice: ErrorNotice | null) => void;
  /** Test id of the overflow menu; projectionDetail's by default. */
  readonly overflowTestId?: string;
}): ReactNode {
  const t = useTranslation();
  const { toMenuItem, confirmDialog: pendingActionDialog } = useActionMenuItems({
    Dialog,
    onError,
  });
  if (compact && PageHeader !== undefined) {
    const compactPrimary = compactHeaderPrimary(actions, preferredPrimaryId);
    const overflowActions = actions.filter((a) => a !== compactPrimary?.action);
    return (
      <>
        {compactPrimary !== undefined && (
          <RenderEditActionButton
            key={compactPrimary.action.id}
            action={compactPrimary.action}
            Button={Button}
            Dialog={Dialog}
            iconOnly={compactPrimary.iconOnly}
            compactLabel
            onError={onError}
          />
        )}
        {overflowActions.length > 0 && (
          <PageHeader overflowItems={overflowActions.map(toMenuItem)} />
        )}
        {pendingActionDialog}
      </>
    );
  }
  const maxPlainButtons = collapseAfterPrimary ? 1 : 2;
  if (actions.length <= maxPlainButtons || ActionOverflowMenu === undefined) {
    return (
      <>
        {orderPlainHeaderActions(actions, preferredPrimaryId).map((action) => (
          <RenderEditActionButton
            key={action.id}
            action={action}
            Button={Button}
            Dialog={Dialog}
            hideIcon
            onError={onError}
          />
        ))}
      </>
    );
  }
  const primary = primaryHeaderAction(actions, preferredPrimaryId);
  const rest = actions.filter((a) => a.id !== primary?.id);
  return (
    <>
      {primary !== undefined && (
        <RenderEditActionButton
          key={primary.id}
          action={primary}
          Button={Button}
          Dialog={Dialog}
          hideIcon
          onError={onError}
        />
      )}
      <ActionOverflowMenu
        label={t("kumiko.list.row-actions.more")}
        testId={overflowTestId}
        items={rest.map(toMenuItem)}
      />
      {pendingActionDialog}
    </>
  );
}
