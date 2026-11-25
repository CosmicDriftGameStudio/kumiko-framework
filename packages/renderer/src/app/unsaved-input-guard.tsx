import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "../i18n.tsx";
import { usePrimitives } from "../primitives.tsx";

export type UnsavedInputGuard = {
  readonly hasUnsavedInput: boolean;
  readonly setHasUnsavedInput: (dirty: boolean) => void;
  readonly confirmOpen: boolean;
  /** Closes right away, or asks first while input is unsaved. */
  readonly requestClose: () => void;
  /** Like `requestClose`, then runs `next` once closed; a refused discard never runs it. */
  readonly requestCloseThen: (next: () => void) => void;
  readonly confirmDiscard: () => void;
  readonly cancelDiscard: () => void;
};

/** The "discard unsaved input?" state a drawer and a form shown in place share. */
export function useUnsavedInputGuard(close: () => void): UnsavedInputGuard {
  const [hasUnsavedInput, setHasUnsavedInput] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const afterCloseRef = useRef<(() => void) | undefined>(undefined);
  const [afterClose, setAfterClose] = useState<{ readonly run: () => void } | null>(null);
  // `next` waits for the commit that unmounts the form: run synchronously, that form still reports dirty and a second leave question follows.
  useEffect(() => {
    if (afterClose === null) return;
    setAfterClose(null);
    afterClose.run();
  }, [afterClose]);
  const confirmDiscard = useCallback(() => {
    setHasUnsavedInput(false);
    setConfirmOpen(false);
    close();
    const next = afterCloseRef.current;
    afterCloseRef.current = undefined;
    if (next !== undefined) setAfterClose({ run: next });
  }, [close]);
  // The next request always overwrites a stale `afterCloseRef`, and the dialog may report "closed" before or after its confirm.
  const cancelDiscard = useCallback(() => setConfirmOpen(false), []);
  const requestCloseThen = useCallback(
    (next: () => void) => {
      afterCloseRef.current = next;
      if (hasUnsavedInput) setConfirmOpen(true);
      else confirmDiscard();
    },
    [hasUnsavedInput, confirmDiscard],
  );
  const requestClose = useCallback(() => {
    afterCloseRef.current = undefined;
    if (hasUnsavedInput) setConfirmOpen(true);
    else confirmDiscard();
  }, [hasUnsavedInput, confirmDiscard]);
  return {
    hasUnsavedInput,
    setHasUnsavedInput,
    confirmOpen,
    requestClose,
    requestCloseThen,
    confirmDiscard,
    cancelDiscard,
  };
}

export function UnsavedInputDialog({ guard }: { readonly guard: UnsavedInputGuard }): ReactNode {
  const { Dialog } = usePrimitives();
  const t = useTranslation();
  return (
    <Dialog
      open={guard.confirmOpen}
      onOpenChange={(open) => {
        if (!open) guard.cancelDiscard();
      }}
      title={t("kumiko.drawer.discard.title")}
      description={t("kumiko.drawer.discard.body")}
      confirmLabel={t("kumiko.drawer.discard.confirm")}
      cancelLabel={t("kumiko.drawer.discard.cancel")}
      variant="danger"
      initialFocus="cancel"
      onConfirm={guard.confirmDiscard}
      testId="drawer-discard-dialog"
    />
  );
}
