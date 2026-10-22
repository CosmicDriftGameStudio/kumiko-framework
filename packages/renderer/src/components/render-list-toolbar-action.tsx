import type { IconKey } from "@cosmicdrift/kumiko-framework/ui-types";
import { type ReactNode, useState } from "react";
import type { usePrimitives } from "../primitives.tsx";
import { needsActionConfirm } from "./render-edit-action-button.tsx";

// Resolved form of a toolbar action: KumikoScreen builds this from the
// schema (either navigate or writeHandler kind), while RenderList sees
// only an onTrigger callback plus label/style and no longer needs to
// discriminate between kinds.
export type ToolbarActionButton = {
  readonly id: string;
  readonly label: string;
  readonly style?: "primary" | "secondary" | "danger";
  readonly confirm?: string;
  readonly confirmLabel?: string;
  /** Overrides the default "danger implies a confirm dialog" rule. Schema-driven
   *  navigate/drawer actions set it to false: the colour marks the action as
   *  destructive, but the target form is the confirmation. */
  readonly confirmRequired?: boolean;
  readonly onTrigger: () => Promise<void> | void;
  /** Id-derived default icon (ACTION_ICON_BY_ID in kumiko-screen.tsx) —
   *  ToolbarAction has no author-declared icon field, unlike RowAction. */
  readonly icon?: IconKey;
};

// ToolbarActionView renders one button per toolbar action, with a confirm
// dialog when required. It follows the inline RowAction pattern but has no
// row context. The busy state covers async onTrigger; the dialog opens before
// the trigger when confirmation is required for confirm/danger actions.
export function ToolbarActionView({
  action,
  iconOnly = false,
  Button,
  Dialog,
  Banner,
}: {
  readonly action: ToolbarActionButton;
  /** Group-level collapse (see `shouldRenderActionsIconOnly`) — only takes
   *  effect when this action actually resolved an icon. */
  readonly iconOnly?: boolean;
  readonly Button: ReturnType<typeof usePrimitives>["Button"];
  readonly Dialog: ReturnType<typeof usePrimitives>["Dialog"];
  readonly Banner: ReturnType<typeof usePrimitives>["Banner"];
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Toolbar actions do not have access to the toast primitive, unlike
  // rowActions routed through the DataTable primitive, so an inline error
  // banner is used to surface failures. Without it, a swallowed failure result
  // would look to the user as though nothing happened.
  const [errorText, setErrorText] = useState<string | null>(null);

  const trigger = async (): Promise<void> => {
    setBusy(true);
    setErrorText(null);
    try {
      await action.onTrigger();
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const variant: "primary" | "secondary" | "danger" = action.style ?? "secondary";
  const needsConfirm = needsActionConfirm(action);
  const showIconOnly = iconOnly && action.icon !== undefined;

  return (
    <>
      <Button
        variant={variant}
        loading={busy}
        {...(action.icon !== undefined && { icon: action.icon })}
        size={showIconOnly ? "icon" : "md"}
        {...(showIconOnly && { ariaLabel: action.label, title: action.label })}
        onClick={() => {
          if (needsConfirm) {
            setConfirmOpen(true);
          } else {
            void trigger();
          }
        }}
        testId={`render-list-toolbar-action-${action.id}`}
      >
        {showIconOnly ? null : action.label}
      </Button>
      <Dialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={action.label}
        {...(action.confirm !== undefined && { description: action.confirm })}
        confirmLabel={action.confirmLabel ?? action.label}
        {...(action.style === "danger" && { variant: "danger" as const })}
        onConfirm={trigger}
        testId={`render-list-toolbar-action-${action.id}-dialog`}
      />
      {errorText !== null && (
        <Banner variant="error" testId={`render-list-toolbar-action-${action.id}-error`}>
          {errorText}
        </Banner>
      )}
    </>
  );
}
