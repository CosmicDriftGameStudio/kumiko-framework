// Full-size image overlay — ModalShell without confirm/cancel actions.

import type { LightboxImage, LightboxProps } from "@cosmicdrift/kumiko-renderer";
import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "../lib/cn.js";
import { ModalShell } from "./modal-shell.js";

const NAV_BUTTON_CLASS =
  "absolute top-1/2 -translate-y-1/2 flex size-9 items-center justify-center rounded-full border border-border bg-card text-foreground opacity-80 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring";

export function DefaultLightbox(props: LightboxProps): ReactNode {
  const { open, onOpenChange, testId, actions, showPosition = true } = props;
  const t = useTranslation();

  const images: readonly LightboxImage[] =
    "images" in props ? props.images : [{ src: props.src, alt: props.alt }];
  const onIndexChange = "images" in props ? props.onIndexChange : undefined;
  const total = images.length;

  // Clamped here so a stale index after the image set shrinks never renders blank.
  const requestedIndex = "images" in props ? props.index : 0;
  const index = Math.min(Math.max(requestedIndex, 0), total - 1);
  const current = images[index];
  if (current === undefined) return null;
  const canNavigate = onIndexChange !== undefined && total > 1;

  const goTo = (target: number): void => {
    onIndexChange?.((target + total) % total);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      goTo(index + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      goTo(index - 1);
    }
  };

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      testId={testId}
      closeLabel={t("kumiko.dialog.close")}
      noAriaDescription
      {...(canNavigate && { onContentKeyDown: handleKeyDown })}
      contentClassName={cn(
        "border-0 bg-transparent p-0 shadow-none",
        "max-w-[95vw] max-h-[90vh] w-auto",
      )}
    >
      <DialogPrimitive.Title className="sr-only">{current.alt}</DialogPrimitive.Title>
      <img
        src={current.src}
        alt={current.alt}
        className="block max-h-[85vh] max-w-[90vw] w-auto rounded-lg border border-border bg-card shadow-lg"
      />
      {canNavigate && (
        <>
          <button
            type="button"
            aria-label={t("kumiko.lightbox.previous")}
            onClick={() => goTo(index - 1)}
            className={cn(NAV_BUTTON_CLASS, "left-2")}
          >
            <ChevronLeft className="size-5" />
          </button>
          <button
            type="button"
            aria-label={t("kumiko.lightbox.next")}
            onClick={() => goTo(index + 1)}
            className={cn(NAV_BUTTON_CLASS, "right-2")}
          >
            <ChevronRight className="size-5" />
          </button>
          {showPosition && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-card px-3 py-1 text-xs text-foreground shadow-sm">
              {t("kumiko.lightbox.position", { current: index + 1, total })}
            </div>
          )}
        </>
      )}
      {actions !== undefined && (
        <div
          data-testid={testId !== undefined ? `${testId}-actions` : undefined}
          className="absolute left-2 top-2 flex items-center gap-2"
        >
          {actions}
        </div>
      )}
    </ModalShell>
  );
}
