import { ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

/** Collapsible section using native <details> with React-controlled state; otherwise
 *  the open attribute resets to its initial value on every parent re-render.
 *  Provides consistent styling for all “Erweitert”/“Mehr” sections. */
export function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
  testId,
  onOpenChange,
}: {
  readonly title: string;
  readonly defaultOpen?: boolean;
  readonly children: ReactNode;
  readonly testId?: string;
  /** Called whenever the section opens or closes after mount, including a late `defaultOpen` flip to true; the mount-time `defaultOpen` does not trigger it. */
  readonly onOpenChange?: (open: boolean) => void;
}): ReactNode {
  const [open, setOpen] = useState(defaultOpen);
  const openRef = useRef(open);
  openRef.current = open;
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const mountedRef = useRef(false);
  // useState(defaultOpen) reads only the mount-time value; an asynchronously hydrated
  // draft flips `defaultOpen` too late for the lazy initializer. An open-only
  // effect never overrides the user's manual collapse.
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (!defaultOpen || openRef.current) return;
    setOpen(true);
    onOpenChangeRef.current?.(true);
  }, [defaultOpen]);
  return (
    <details
      data-testid={testId}
      className="group rounded-lg border bg-card"
      open={open}
      onToggle={(e) => {
        const next = e.currentTarget.open;
        // The browser also fires toggle when React sets `open` (mount with defaultOpen,
        // late hydration); only a change against our state comes from the user.
        if (next === open) return;
        setOpen(next);
        onOpenChange?.(next);
      }}
    >
      {/* min-h-9 matches the form controls it often sits next to */}
      <summary className="flex min-h-9 py-1.5 cursor-pointer select-none items-center justify-between gap-2 rounded-lg px-4 text-sm font-medium hover:bg-muted/50 [&::-webkit-details-marker]:hidden">
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
