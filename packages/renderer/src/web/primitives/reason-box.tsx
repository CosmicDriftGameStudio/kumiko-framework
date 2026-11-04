import { Info } from "lucide-react";
import type { ReactNode } from "react";

/** The opened "why" of a hint or step: an inverted box, so it reads as a note on top of the row tint. */
export function ReasonBox({
  children,
  testId,
  ...dataAttributes
}: {
  readonly children: ReactNode;
  readonly testId?: string;
  readonly "data-hint-reason"?: "true";
}): ReactNode {
  return (
    // A span: the box can sit inside a hint cell's inline flow, where only phrasing content is valid.
    <span
      data-testid={testId}
      {...dataAttributes}
      className="block rounded-md bg-foreground px-3 py-2 text-sm text-background whitespace-pre-line"
    >
      {children}
    </span>
  );
}

/** Info icon that opens a ReasonBox; sits next to a title and never opens a clickable row around it. */
export function ReasonInfoButton({
  label,
  open,
  onToggle,
  ...dataAttributes
}: {
  readonly label: string;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly "data-hint-reason-toggle"?: "true";
}): ReactNode {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={label}
      title={label}
      {...dataAttributes}
      className="shrink-0 text-muted-foreground hover:text-foreground"
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <Info className="size-4" aria-hidden="true" />
    </button>
  );
}
