// shadcn-Style Dialog via @radix-ui/react-dialog. Confirm-Button-
// Variant kommt aus dem Standard-Button-Pattern; Cancel ist immer
// secondary. Async-onConfirm wird über loading-State gerendert
// (Spinner im Confirm-Button bis der Promise resolved).
//
// Ausgelagert von primitives/index.tsx weil das Radix-Setup mehrere
// Dependencies und Sub-Exports zieht — hält das Primitives-Hauptfile
// schlank.

import type { DialogProps } from "@kumiko/renderer";
import { useTranslation } from "@kumiko/renderer";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Loader2, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "../lib/cn";

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
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  }

  const isDanger = variant === "danger";
  const confirmClass = isDanger
    ? "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90"
    : "bg-primary text-primary-foreground shadow hover:bg-primary/90";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          data-testid={testId}
          className={cn(
            "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-card p-6 shadow-lg",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "rounded-lg",
          )}
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
          <DialogPrimitive.Close asChild>
            <button
              type="button"
              aria-label={t("kumiko.dialog.close")}
              className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none"
            >
              <X className="size-4" />
            </button>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
