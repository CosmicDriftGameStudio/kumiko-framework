import type { ReactNode } from "react";
import { useState } from "react";
import type { usePrimitives } from "../primitives";
import type { RenderEditAction } from "./render-edit-types";

// One header action + its own busy/confirm state — same pattern as
// render-list.tsx's ToolbarActionView (each RenderEditAction is
// independently bound by the caller, there is no shared trigger pipeline
// to hook into like the built-in onDelete/onSubmit paths have).
export function RenderEditActionButton({
  action,
  Button,
  Dialog,
  onError,
}: {
  readonly action: RenderEditAction;
  readonly Button: ReturnType<typeof usePrimitives>["Button"];
  readonly Dialog: ReturnType<typeof usePrimitives>["Dialog"];
  readonly onError: (text: string | null) => void;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const trigger = async (): Promise<void> => {
    setBusy(true);
    onError(null);
    try {
      await action.onPress();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const variant = action.style ?? "secondary";
  // Same rule as RowActionWriteHandler: "danger" forces a confirm even
  // without an explicit confirm key.
  const needsConfirm = action.confirm !== undefined || action.style === "danger";

  return (
    <>
      <Button
        type="button"
        variant={variant}
        loading={busy}
        onClick={() => {
          if (needsConfirm) {
            setConfirmOpen(true);
          } else {
            void trigger();
          }
        }}
        testId={`render-edit-action-${action.id}`}
      >
        {action.label}
      </Button>
      <Dialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={action.label}
        {...(action.confirm !== undefined && { description: action.confirm })}
        confirmLabel={action.confirmLabel ?? action.label}
        {...(action.style === "danger" && { variant: "danger" as const })}
        onConfirm={trigger}
        testId={`render-edit-action-${action.id}-dialog`}
      />
    </>
  );
}
