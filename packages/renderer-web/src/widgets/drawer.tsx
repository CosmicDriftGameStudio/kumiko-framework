import type { ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet";

export type DrawerProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly side?: "left" | "right" | "top" | "bottom";
  readonly title?: ReactNode;
  readonly description?: ReactNode;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
  readonly testId?: string;
};

/** Slide-in panel beside a list (e.g. mail reader next to the inbox) —
 *  thin wrapper over the Sheet primitive with header/body/footer slots
 *  so screens skip per-route Radix boilerplate. */
export function Drawer({
  open,
  onOpenChange,
  side = "right",
  title,
  description,
  footer,
  children,
  testId,
}: DrawerProps): ReactNode {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={side} data-testid={testId}>
        {(title !== undefined || description !== undefined) && (
          <SheetHeader>
            {title !== undefined && <SheetTitle>{title}</SheetTitle>}
            {description !== undefined && <SheetDescription>{description}</SheetDescription>}
          </SheetHeader>
        )}
        <div className="flex-1 overflow-y-auto px-4">{children}</div>
        {footer !== undefined && <SheetFooter>{footer}</SheetFooter>}
      </SheetContent>
    </Sheet>
  );
}
