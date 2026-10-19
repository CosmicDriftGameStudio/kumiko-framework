import { ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

/** Aufklappbare Sektion (native <details>, aber React-kontrolliert: sonst
 *  springt das open-Attribut bei jedem Parent-Re-Render auf den Initialwert
 *  zurück). Eine Optik für alle „Erweitert"/„Mehr"-Abschnitte. */
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
  // useState(defaultOpen) liest nur den Mount-Wert — ein async hydrierter
  // Draft flippt `defaultOpen` zu spät für den Lazy-Initializer. Open-only
  // Effect: kämpft nie gegen ein manuelles Zuklappen des Users.
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
