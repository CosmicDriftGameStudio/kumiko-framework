// Tier 2.1c: Searchable Select / Combobox.
//
// Pattern ist das shadcn-Standard-Combobox: Popover-Trigger als Button
// (zeigt aktuellen Wert oder Placeholder), Popover-Content enthält
// cmdk-Command mit Search-Input + filterable Item-List.
//
// cmdk ist Radix's Standard-Combobox (Library für Command-K + Searchable
// Selects), client-side Fuzzy-Match via `Command.Filter` mit Default-
// Behavior. Server-side Remote-Search (debounced query) ist nicht im
// MVP — kommt später als zweiter Mode-Schalter.
//
// Multi-Mode: `multiple: true` schaltet auf Tag-Anzeige + Mehrfach-
// Auswahl. Selected-Tags rendern als kleine entfernbare Chips, das
// Search-Input bleibt offen für weitere Auswahl.

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { Check, ChevronDown } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "../lib/cn";

export type ComboboxOption = { readonly value: string; readonly label: string };

export type ComboboxInputProps = {
  readonly id: string;
  readonly name: string;
  /** Single-Mode: ein String (UUID/value). Multi-Mode: string[]. */
  readonly value: string | readonly string[];
  /** Single-Mode wird mit string aufgerufen, Multi-Mode mit string[]. */
  readonly onChange: (v: string | readonly string[]) => void;
  readonly options: readonly ComboboxOption[];
  readonly multiple?: boolean;
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly hasError?: boolean;
  readonly placeholder?: string;
  readonly searchPlaceholder?: string;
  readonly emptyText?: string;
};

const triggerClass =
  "flex h-9 w-full items-center justify-between rounded-md border border-input " +
  "bg-transparent px-3 py-1 text-sm shadow-sm transition-colors " +
  "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 " +
  "focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const popoverContentClass =
  "z-50 w-[var(--radix-popover-trigger-width)] rounded-md border bg-popover " +
  "p-0 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in " +
  "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 " +
  "data-[state=open]:fade-in-0";

const tagClass =
  "inline-flex items-center gap-1 rounded-sm bg-muted px-2 py-0.5 text-xs " +
  "font-medium text-muted-foreground";

export function ComboboxInput({
  id,
  name,
  value,
  onChange,
  options,
  multiple = false,
  disabled,
  required,
  hasError,
  placeholder = "—",
  searchPlaceholder,
  emptyText = "No matches.",
}: ComboboxInputProps): ReactNode {
  const [open, setOpen] = useState(false);
  // Multi-Mode hält value als Array; Single-Mode als String. Wir
  // normalisieren intern auf Set für Lookup-Schnelligkeit.
  const selectedValues = multiple
    ? new Set(Array.isArray(value) ? value : value === "" ? [] : [value as string])
    : new Set<string>();
  const singleValue = !multiple && typeof value === "string" ? value : "";
  const singleLabel = options.find((o) => o.value === singleValue)?.label ?? "";

  const toggleMulti = (v: string): void => {
    const current = Array.isArray(value) ? [...value] : [];
    const idx = current.indexOf(v);
    if (idx >= 0) current.splice(idx, 1);
    else current.push(v);
    onChange(current);
  };

  const triggerLabel = multiple ? null : singleLabel === "" ? placeholder : singleLabel;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <input type="hidden" name={name} value={Array.isArray(value) ? value.join(",") : value} />
      <PopoverPrimitive.Trigger
        id={id}
        data-testid={`combobox-${id}`}
        type="button"
        disabled={disabled}
        aria-required={required}
        aria-invalid={hasError === true ? true : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          triggerClass,
          hasError === true && "border-destructive focus-visible:ring-destructive",
        )}
      >
        {multiple ? (
          <span className="flex flex-wrap items-center gap-1">
            {selectedValues.size === 0 ? (
              <span className="text-muted-foreground">{placeholder}</span>
            ) : (
              // Tags sind read-only Anzeige (kein nested <button>
              // möglich im Trigger-<button>). Entfernen via Re-Click
              // im Combobox-Popup — der Item-Toggle deselektiert die
              // entsprechende Option (analog shadcn-Standard-Combobox).
              [...selectedValues].map((v) => {
                const opt = options.find((o) => o.value === v);
                return (
                  <span key={v} className={tagClass}>
                    {opt?.label ?? v}
                  </span>
                );
              })
            )}
          </span>
        ) : (
          <span className={singleLabel === "" ? "text-muted-foreground" : ""}>{triggerLabel}</span>
        )}
        <ChevronDown className="h-4 w-4 opacity-50" />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content className={popoverContentClass} align="start" sideOffset={4}>
          <Command>
            <Command.Input
              placeholder={searchPlaceholder ?? "Search…"}
              className="flex h-9 w-full border-0 border-b border-border bg-transparent px-3 py-1 text-sm outline-none placeholder:text-muted-foreground"
            />
            <Command.List className="max-h-64 overflow-y-auto p-1">
              <Command.Empty className="py-3 text-center text-sm text-muted-foreground">
                {emptyText}
              </Command.Empty>
              {options.map((opt) => {
                const isSelected = multiple
                  ? selectedValues.has(opt.value)
                  : opt.value === singleValue;
                return (
                  <Command.Item
                    key={opt.value}
                    value={opt.label}
                    onSelect={() => {
                      if (multiple) {
                        toggleMulti(opt.value);
                      } else {
                        onChange(opt.value);
                        setOpen(false);
                      }
                    }}
                    className="relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none aria-selected:bg-accent aria-selected:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                  >
                    {isSelected && (
                      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                        <Check className="h-4 w-4" />
                      </span>
                    )}
                    <span>{opt.label}</span>
                  </Command.Item>
                );
              })}
            </Command.List>
          </Command>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
