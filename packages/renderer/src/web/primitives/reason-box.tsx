import { Info } from "lucide-react";
import type { ReactNode } from "react";

/** The opened "why" of a hint or step: a dark note box with a small arrow at the top left, so it reads as a note on top of the row tint. */
export function ReasonBox({
  children,
  title,
  testId,
  id,
  ...dataAttributes
}: {
  readonly children: ReactNode;
  /** Bold lead-in of the paragraph. */
  readonly title?: string;
  readonly testId?: string;
  /** Target of the info button's `aria-controls`. */
  readonly id?: string;
  readonly "data-hint-reason"?: "true";
}): ReactNode {
  return (
    // A span: the box can sit inside a hint cell's inline flow, where only phrasing content is valid.
    <span
      data-testid={testId}
      id={id}
      {...dataAttributes}
      className="relative mt-1 block rounded-md bg-sidebar px-3 py-2.5 text-[12.5px] leading-[1.45] text-sidebar-foreground whitespace-pre-line before:absolute before:-top-[5px] before:left-[18px] before:border-[5px] before:border-t-0 before:border-transparent before:border-b-sidebar before:content-['']"
    >
      {title !== undefined && <b className="font-semibold">{title} </b>}
      {children}
    </span>
  );
}

/** Info icon that opens a ReasonBox; sits next to a title and never opens a clickable row around it. */
export function ReasonInfoButton({
  label,
  open,
  onToggle,
  controls,
  ...dataAttributes
}: {
  readonly label: string;
  readonly open: boolean;
  readonly onToggle: () => void;
  /** Id of the box this button opens; only referenced while open. */
  readonly controls?: string;
  readonly "data-hint-reason-toggle"?: "true";
}): ReactNode {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
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
