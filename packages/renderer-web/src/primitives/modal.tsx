// Bare content shell for hosting self-contained widgets (own submit/cancel
// buttons) in a modal overlay — same Radix chrome as DefaultDialog, no
// footer buttons of its own.

import type { ModalProps } from "@cosmicdrift/kumiko-renderer";
import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { ModalShell } from "./modal-shell";

export function DefaultModal({
  open,
  onOpenChange,
  title,
  children,
  testId,
}: ModalProps): ReactNode {
  const t = useTranslation();
  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      testId={testId}
      closeLabel={t("kumiko.dialog.close")}
      noAriaDescription
      contentClassName={cn("grid w-full max-w-lg gap-4 border bg-card p-6 shadow-lg rounded-lg")}
    >
      <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
      {/* React re-parents portal content into the enclosing React tree for
          event bubbling (it only escapes the DOM tree, not the fiber tree) —
          without stopping it here, submitting a form hosted in this modal
          would also bubble into an ancestor <form>'s onSubmit if the modal
          was opened from inside one (e.g. a reference field's create dialog
          nested in the host entity's own form, kumiko-framework#1681). */}
      <div onSubmit={(e) => e.stopPropagation()}>{children}</div>
    </ModalShell>
  );
}
