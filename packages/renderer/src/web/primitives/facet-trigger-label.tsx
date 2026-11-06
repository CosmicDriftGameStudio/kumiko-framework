import type { ReactNode } from "react";

export const FACET_PILL_CLASSES = "h-9 rounded-full border-border-strong px-3";

// The label keeps its trailing ": " so textContent reads "Label: Value"; the button gap draws the space.
// A pill with nothing chosen names the facet only, like the boards ("Property ▾").
export function FacetTriggerLabel({
  field,
  label,
  emptyValueLabel,
  showEmptyValue,
}: {
  readonly field: string;
  readonly label: string;
  readonly emptyValueLabel: string;
  readonly showEmptyValue: boolean;
}): ReactNode {
  if (!showEmptyValue) return <span className="text-muted-foreground">{label}</span>;
  return (
    <>
      <span className="text-muted-foreground">{`${label}: `}</span>
      <span data-testid={`facet-${field}-value`} className="text-foreground">
        {emptyValueLabel}
      </span>
    </>
  );
}
