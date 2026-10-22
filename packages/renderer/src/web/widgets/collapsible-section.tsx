import { ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

/** Collapsible section using native <details> with React-controlled state; otherwise
 *  the open attribute resets to its initial value on every parent re-render.
 *  Provides consistent styling for all “Erweitert”/“Mehr” sections. */
export function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
  testId,
}: {
  readonly title: string;
  readonly defaultOpen?: boolean;
  readonly children: ReactNode;
  readonly testId?: string;
}): ReactNode {
  const [open, setOpen] = useState(defaultOpen);
  // useState(defaultOpen) reads only the mount-time value; an asynchronously hydrated
  // draft flips `defaultOpen` too late for the lazy initializer. An open-only
  // effect never overrides the user's manual collapse.
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);
  return (
    <details
      data-testid={testId}
      className="group rounded-lg border bg-card"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="flex cursor-pointer select-none items-center justify-between gap-2 rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-muted/50 [&::-webkit-details-marker]:hidden">
        <span>{title}</span>
        <ChevronRight
          aria-hidden="true"
          className="size-4 text-muted-foreground transition-transform group-open:rotate-90"
        />
      </summary>
      <div className="border-t px-4 py-3">{children}</div>
    </details>
  );
}
