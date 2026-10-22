import { type ReactNode, useState } from "react";
import type { DataTableRangeBound, DataTableRangeFacet } from "../../data-table-aggregate-types.ts";
import { useOptionalTranslation } from "../../index.ts";

const INPUT_CLASS =
  "h-9 w-24 rounded-md border border-input bg-transparent px-2 text-sm tabular-nums shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 max-md:min-h-11";

// A keystroke must not refetch the list, so a bound commits on blur or Enter;
// a value changed from outside (reset, back navigation) replaces the draft.
function RangeBoundInput({
  facet,
  bound,
  label,
  onCommit,
}: {
  readonly facet: DataTableRangeFacet;
  readonly bound: DataTableRangeBound;
  readonly label: string;
  readonly onCommit: (field: string, bound: DataTableRangeBound, value: string) => void;
}): ReactNode {
  const committed = facet[bound];
  const [draft, setDraft] = useState(committed);
  const [seen, setSeen] = useState(committed);
  if (seen !== committed) {
    setSeen(committed);
    setDraft(committed);
  }
  const commit = (): void => {
    const trimmed = draft.trim();
    if (trimmed !== "" && !Number.isFinite(Number(trimmed))) {
      setDraft(committed);
      return;
    }
    if (trimmed !== committed) onCommit(facet.field, bound, trimmed);
  };
  return (
    <input
      type="number"
      inputMode="decimal"
      step="any"
      className={INPUT_CLASS}
      value={draft}
      placeholder={label}
      aria-label={`${facet.label} ${label}`}
      data-testid={`facet-range-${facet.field}-${bound}`}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
    />
  );
}

/** "From/to" bounds of a number, decimal, money or bigInt field. */
export function NumberRangeFacetFilter({
  facet,
  onChange,
}: {
  readonly facet: DataTableRangeFacet;
  readonly onChange: (field: string, bound: DataTableRangeBound, value: string) => void;
}): ReactNode {
  const translate = useOptionalTranslation();
  return (
    <div className="flex items-center gap-2" data-testid={`facet-range-${facet.field}`}>
      <span className="text-sm text-muted-foreground">{facet.label}</span>
      <RangeBoundInput
        facet={facet}
        bound="min"
        label={translate?.("kumiko.list.range.min") ?? "From"}
        onCommit={onChange}
      />
      <span className="text-sm text-muted-foreground">–</span>
      <RangeBoundInput
        facet={facet}
        bound="max"
        label={translate?.("kumiko.list.range.max") ?? "To"}
        onCommit={onChange}
      />
      {facet.unit !== undefined && (
        <span className="text-sm text-muted-foreground">{facet.unit}</span>
      )}
    </div>
  );
}
