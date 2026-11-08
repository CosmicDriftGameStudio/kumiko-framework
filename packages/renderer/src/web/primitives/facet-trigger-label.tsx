import type { ReactNode } from "react";

export const FACET_PILL_CLASSES = "h-9 rounded-full border-border-strong px-3";

// A facet with nothing chosen names itself only, like the boards ("Property ▾").
export function FacetTriggerLabel({ label }: { readonly label: string }): ReactNode {
  return <span className="text-muted-foreground">{label}</span>;
}
