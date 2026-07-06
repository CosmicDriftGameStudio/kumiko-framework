// Full-size image overlay — ModalShell without confirm/cancel actions.

import type { LightboxProps } from "@cosmicdrift/kumiko-renderer";
import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { ModalShell } from "./modal-shell";

export function DefaultLightbox({
  open,
  onOpenChange,
  src,
  alt,
  testId,
}: LightboxProps): ReactNode {
  const t = useTranslation();

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      testId={testId}
      closeLabel={t("kumiko.dialog.close")}
      noAriaDescription
      contentClassName={cn(
        "border-0 bg-transparent p-0 shadow-none",
        "max-w-[95vw] max-h-[90vh] w-auto",
      )}
    >
      <DialogPrimitive.Title className="sr-only">{alt}</DialogPrimitive.Title>
      <img
        src={src}
        alt={alt}
        className="block max-h-[85vh] max-w-[90vw] w-auto rounded-lg border border-border bg-card shadow-lg"
      />
    </ModalShell>
  );
}
