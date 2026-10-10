import { type ReactNode, useState } from "react";
import type { ActionMenuItemSpec, usePrimitives } from "../primitives.js";
import { needsActionConfirm, RenderEditActionConfirmDialog } from "./render-edit-action-button.js";
import type { RenderEditAction } from "./render-edit-types.js";

// A menu item has no button of its own to carry RenderEditActionButton's busy
// and confirm state, so this hook owns both for every item it creates.
export function useActionMenuItems({
  Dialog,
  onError,
}: {
  readonly Dialog: ReturnType<typeof usePrimitives>["Dialog"];
  readonly onError: (text: string | null) => void;
}): {
  readonly toMenuItem: (action: RenderEditAction) => ActionMenuItemSpec;
  readonly confirmDialog: ReactNode;
} {
  const [pendingAction, setPendingAction] = useState<RenderEditAction | null>(null);
  // Without it the menu can be reopened mid-write and fire the same writeHandler twice.
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const trigger = async (action: RenderEditAction): Promise<void> => {
    onError(null);
    setBusyActionId(action.id);
    try {
      await action.onPress();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyActionId(null);
    }
  };
  const toMenuItem = (action: RenderEditAction): ActionMenuItemSpec => ({
    id: action.id,
    label: action.label,
    ...(action.icon !== undefined && { icon: action.icon }),
    variant: action.style === "danger" ? ("danger" as const) : ("default" as const),
    ...(busyActionId !== null && { disabled: true }),
    onSelect: () => {
      if (needsActionConfirm(action)) {
        setPendingAction(action);
      } else {
        void trigger(action);
      }
    },
  });
  const confirmDialog = pendingAction !== null && (
    <RenderEditActionConfirmDialog
      action={pendingAction}
      open={true}
      onOpenChange={(open) => {
        if (!open) setPendingAction(null);
      }}
      onConfirm={async () => {
        const action = pendingAction;
        setPendingAction(null);
        await trigger(action);
      }}
      Dialog={Dialog}
    />
  );
  return { toMenuItem, confirmDialog };
}
