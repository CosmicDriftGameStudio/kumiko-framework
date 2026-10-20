import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "./i18n.tsx";
import { setLeaveConfirmer } from "./leave-guard.ts";
import { usePrimitives } from "./primitives.tsx";

type PendingLeave = { readonly proceed: () => void; readonly cancel: () => void };

export function LeaveGuardDialog(): ReactNode {
  const { Dialog } = usePrimitives();
  const t = useTranslation();
  const [pending, setPending] = useState<PendingLeave | null>(null);
  // Dialog fires onOpenChange(false) after onConfirm too; the ref lets that
  // follow-up see the request is already settled instead of cancelling it.
  const pendingRef = useRef<PendingLeave | null>(null);

  useEffect(
    () =>
      setLeaveConfirmer((request) => {
        pendingRef.current = request;
        setPending(request);
      }),
    [],
  );

  const settle = useCallback((decide: (request: PendingLeave) => void) => {
    const request = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    if (request !== null) decide(request);
  }, []);

  return (
    <Dialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) settle((request) => request.cancel());
      }}
      title={t("kumiko.drawer.discard.title")}
      description={t("kumiko.drawer.discard.body")}
      confirmLabel={t("kumiko.drawer.discard.confirm")}
      cancelLabel={t("kumiko.drawer.discard.cancel")}
      variant="danger"
      initialFocus="cancel"
      onConfirm={() => settle((request) => request.proceed())}
      testId="leave-guard-dialog"
    />
  );
}
