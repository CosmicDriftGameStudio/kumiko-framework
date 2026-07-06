// Confirm dialog built on ModalShell. Cancel is always secondary; async
// onConfirm shows a spinner on the confirm button until the promise settles.

import type { DialogProps } from "@cosmicdrift/kumiko-renderer";
import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Loader2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "../lib/cn";
import { ModalShell } from "./modal-shell";

export function DefaultDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  variant = "default",
  onConfirm,
  children,
  testId,
}: DialogProps): ReactNode {
  const t = useTranslation();
  const [loading, setLoading] = useState(false);

  const effectiveConfirmLabel = confirmLabel ?? t("kumiko.dialog.confirm");
  const effectiveCancelLabel = cancelLabel ?? t("kumiko.dialog.cancel");

  async function handleConfirm(): Promise<void> {
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
      onOpenChange(false);
    }
  }

  const isDanger = variant === "danger";
  const confirmClass = isDanger
    ? "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90"
    : "bg-primary text-primary-foreground shadow hover:bg-primary/90";

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      testId={testId}
      closeLabel={t("kumiko.dialog.close")}
      noAriaDescription={description === undefined}
      contentClassName={cn("grid w-full max-w-lg gap-4 border bg-card p-6 shadow-lg rounded-lg")}
    >
      <div className="flex flex-col gap-1.5">
        <DialogPrimitive.Title className="text-lg font-semibold tracking-tight">
          {title}
        </DialogPrimitive.Title>
        {description !== undefined && (
          <DialogPrimitive.Description className="text-sm text-muted-foreground">
            {description}
          </DialogPrimitive.Description>
        )}
      </div>
      {children !== undefined && <div>{children}</div>}
      <div className="flex items-center justify-end gap-2">
        <DialogPrimitive.Close asChild>
          <button
            type="button"
            disabled={loading}
            data-testid={testId !== undefined ? `${testId}-cancel` : undefined}
            className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
          >
            {effectiveCancelLabel}
          </button>
        </DialogPrimitive.Close>
        <button
          type="button"
          onClick={() => void handleConfirm()}
          disabled={loading}
          data-testid={testId !== undefined ? `${testId}-confirm` : undefined}
          className={cn(
            "inline-flex h-9 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium",
            "disabled:pointer-events-none disabled:opacity-50",
            confirmClass,
          )}
        >
          {loading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {effectiveConfirmLabel}
        </button>
      </div>
    </ModalShell>
  );
}
