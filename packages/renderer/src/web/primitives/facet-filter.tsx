import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import type { DataTableDateRangeFacet, DataTableFacet } from "../../index.ts";
import { cn } from "../lib/cn.ts";
import { Badge } from "../ui/badge.tsx";
import { Button as UiButton } from "../ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "./dropdown-menu.tsx";
import "../react-css-custom-properties.ts";
import { DefaultButton } from "./button.tsx";

// ---- DataTable (shadcn: Table) ----

function sameValueSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}

// Single-choice chip row for a facet with `chips`: a chip is pressed while the
// current selection equals its values, a click replaces the selection.
function FacetChips({
  facet,
  selected,
  onChange,
}: {
  facet: DataTableFacet;
  selected: readonly string[];
  onChange: (field: string, values: readonly string[]) => void;
}): ReactNode {
  const chips = (facet.chips ?? []).filter(
    (chip) => facet.hideEmpty !== true || chip.count !== 0 || sameValueSet(selected, chip.values),
  );
  return (
    // biome-ignore lint/a11y/useSemanticElements: a <fieldset> brings browser default borders/legend layout the chip row must not have
    <div
      role="group"
      aria-label={facet.label}
      className="flex flex-wrap items-center gap-1.5"
      data-testid={`facet-${facet.field}`}
    >
      {chips.map((chip) => (
        <DefaultButton
          key={chip.id}
          variant="secondary"
          size="sm"
          pressed={sameValueSet(selected, chip.values)}
          onClick={() => onChange(facet.field, chip.values)}
          testId={`facet-${facet.field}-${chip.id}`}
          className="rounded-full"
        >
          {chip.label}
          {facet.showCounts === true && chip.count !== undefined && (
            <span className="tabular-nums text-muted-foreground">{chip.count}</span>
          )}
        </DefaultButton>
      ))}
    </div>
  );
}

// Faceted filter dropdown: outline button (like shadcn's "Columns" toggle) +
// multi-select checkboxes. Active selection -> count badge on the button.
export function FacetFilter({
  facet,
  selected,
  onChange,
  dense = false,
}: {
  facet: DataTableFacet;
  selected: readonly string[];
  onChange: (field: string, values: readonly string[]) => void;
  /** Toolbar of a scrollBody table: h32 with the stronger border. */
  dense?: boolean;
}): ReactNode {
  const toggle = (value: string, checked: boolean): void => {
    const next = checked ? [...selected, value] : selected.filter((v) => v !== value);
    onChange(facet.field, next);
  };
  if (facet.chips !== undefined) {
    return <FacetChips facet={facet} selected={selected} onChange={onChange} />;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <UiButton
          variant="outline"
          size="sm"
          className={cn("h-9", dense && "h-8 border-border-strong px-2.5 max-md:h-11")}
          data-testid={`facet-${facet.field}`}
        >
          {facet.label}
          {selected.length > 0 && (
            <Badge variant="secondary" className="ml-1 rounded-sm px-1 font-normal tabular-nums">
              {selected.length}
            </Badge>
          )}
          <ChevronDown className="text-muted-foreground" />
        </UiButton>
      </DropdownMenuTrigger>
      {/* Radix exposes the room left in the viewport; without the cap a long
          option list runs off-screen and the lower options are unreachable. */}
      <DropdownMenuContent
        align="start"
        className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-44 overflow-y-auto"
      >
        {facet.options.map((opt) => (
          <DropdownMenuCheckboxItem
            key={opt.value}
            checked={selected.includes(opt.value)}
            onCheckedChange={(checked: boolean) => toggle(opt.value, checked)}
            onSelect={(e: Event) => e.preventDefault()}
            data-testid={`facet-${facet.field}-${opt.value}`}
          >
            {opt.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Time-range filter (fw#3104): two native <input type="date"> instead of a
// dropdown — the browser supplies the calendar, the locale and the keyboard
// handling, so no date dependency is needed. Each bound constrains the other
// through min/max so the picker can't offer an inverted span; the caller
// clamps a typed value on top of that.
export function DateRangeFacetFilter({
  facet,
  onChange,
}: {
  facet: DataTableDateRangeFacet;
  onChange: (field: string, bound: "from" | "to", value: string) => void;
}): ReactNode {
  const inputClass =
    "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 max-md:min-h-11";
  return (
    <div className="flex items-center gap-2" data-testid={`facet-daterange-${facet.field}`}>
      <span className="text-sm text-muted-foreground">{facet.label}</span>
      <input
        type="date"
        className={inputClass}
        value={facet.from}
        {...(facet.to !== "" && { max: facet.to })}
        aria-label={`${facet.label} from`}
        data-testid={`facet-daterange-${facet.field}-from`}
        onChange={(e) => onChange(facet.field, "from", e.target.value)}
      />
      <span className="text-sm text-muted-foreground">–</span>
      <input
        type="date"
        className={inputClass}
        value={facet.to}
        {...(facet.from !== "" && { min: facet.from })}
        aria-label={`${facet.label} to`}
        data-testid={`facet-daterange-${facet.field}-to`}
        onChange={(e) => onChange(facet.field, "to", e.target.value)}
      />
    </div>
  );
}
