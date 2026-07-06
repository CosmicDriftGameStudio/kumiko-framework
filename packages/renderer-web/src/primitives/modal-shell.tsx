// Shared Radix dialog chrome for confirm Dialog + image Lightbox.
// Not exported from the package — only an internal building block.

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export type ModalShellProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly children: ReactNode;
  readonly testId?: string;
  readonly contentClassName?: string;
  /** Radix wants aria-describedby={undefined} when there is no Description. */
  readonly noAriaDescription?: boolean;
  readonly closeLabel?: string;
  readonly showCloseButton?: boolean;
};

export function ModalShell({
  open,
  onOpenChange,
  children,
  testId,
  contentClassName,
  noAriaDescription,
  closeLabel,
  showCloseButton = true,
}: ModalShellProps): ReactNode {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          data-testid={testId}
          {...(noAriaDescription && { "aria-describedby": undefined })}
          className={cn(
            "fixed left-[50%] top-[50%] z-50 translate-x-[-50%] translate-y-[-50%]",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            contentClassName,
          )}
        >
          {children}
          {showCloseButton && closeLabel !== undefined && (
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                aria-label={closeLabel}
                className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none"
              >
                <X className="size-4" />
              </button>
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
