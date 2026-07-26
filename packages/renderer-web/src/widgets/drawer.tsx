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

/** Slide-in-Panel neben einer Liste (z.B. Mail-Reader neben der Inbox) —
 *  dünner Wrapper über dem Sheet-Primitive mit Header/Body/Footer-Slots
 *  statt Radix-Boilerplate pro Screen. */
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
