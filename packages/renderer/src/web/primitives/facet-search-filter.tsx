// Facet dropdown with a server-side search field, for reference facets whose option list is a
// capped page. A Radix DropdownMenu would swallow the typed keys for its typeahead, so this is a
// Popover + cmdk list like ComboboxInput, with the facet's own trigger button.

import { Command } from "cmdk";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { type ReactNode, useEffect, useState } from "react";
import { type DataTableFacet, REFERENCE_SEARCH_DEBOUNCE_MS, useTranslation } from "../../index.ts";
import { cn } from "../lib/cn.ts";
import { Badge } from "../ui/badge.tsx";
import { Button as UiButton } from "../ui/button.tsx";

export function FacetSearchFilter({
  facet,
  onSearchChange,
  selected,
  onChange,
  dense,
}: {
  facet: DataTableFacet;
  onSearchChange: (query: string) => void;
  selected: readonly string[];
  onChange: (field: string, values: readonly string[]) => void;
  dense: boolean;
}): ReactNode {
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => onSearchChange(searchTerm), REFERENCE_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchTerm, onSearchChange]);
  useEffect(() => {
    if (!open && searchTerm !== "") setSearchTerm("");
  }, [open, searchTerm]);

  const toggle = (value: string): void => {
    onChange(
      facet.field,
      selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value],
    );
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <UiButton
          variant="outline"
          size="sm"
          className={cn("h-9", dense && "border-border-strong px-2.5")}
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
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          className="z-50 w-64 rounded-md border bg-popover p-0 text-popover-foreground shadow-md outline-none"
        >
          <Command shouldFilter={false}>
            <div className="relative">
              <Command.Input
                value={searchTerm}
                onValueChange={setSearchTerm}
                placeholder={t("kumiko.combobox.search-placeholder")}
                data-testid={`facet-${facet.field}-search`}
                className="flex h-9 w-full border-0 border-b border-border bg-transparent px-3 py-1 text-sm outline-none placeholder:text-muted-foreground"
              />
              {facet.searching === true && (
                <Loader2 className="absolute right-2 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
            <Command.List className="max-h-64 overflow-y-auto p-1">
              <Command.Empty className="py-3 text-center text-sm text-muted-foreground">
                {facet.searching === true
                  ? t("kumiko.combobox.loading")
                  : t("kumiko.combobox.empty")}
              </Command.Empty>
              {facet.options.map((opt) => (
                <Command.Item
                  key={opt.value}
                  value={opt.value}
                  onSelect={() => toggle(opt.value)}
                  data-testid={`facet-${facet.field}-${opt.value}`}
                  className="relative flex cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none aria-selected:bg-accent aria-selected:text-accent-foreground"
                >
                  {selected.includes(opt.value) && (
                    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                      <Check className="h-4 w-4" />
                    </span>
                  )}
                  {opt.label}
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
