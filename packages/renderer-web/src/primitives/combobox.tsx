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

import { REFERENCE_SEARCH_DEBOUNCE_MS, useTranslation } from "@kumiko/renderer";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { cn } from "../lib/cn";

export type ComboboxOption = { readonly value: string; readonly label: string };

// Discriminated Union per `multiple`-Flag — Single-Mode hat string-
// value/onChange, Multi-Mode hat string[]/string[]. Caller muss den
// Mode beim Build entscheiden, der Compiler zwingt dann die richtige
// Signature ohne Runtime-narrow.
type ComboboxBaseProps = {
  readonly id: string;
  readonly name: string;
  readonly options: readonly ComboboxOption[];
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly hasError?: boolean;
  readonly placeholder?: string;
  readonly searchPlaceholder?: string;
  readonly emptyText?: string;
  /** Tier 2.7e Remote-Search: wenn gesetzt, wechselt der Combobox in
   *  Remote-Mode. cmdk's client-side Filter wird deaktiviert (Server
   *  hat schon gefiltert), und der Search-Input ruft onSearchChange
   *  debounced (300ms). Ohne diesen Callback bleibt die Local-Filter-
   *  Variante (cmdk fuzzy-match auf den geladenen options). */
  readonly onSearchChange?: (q: string) => void;
  /** Spinner im Trigger + Popover-Footer wenn remote search läuft. */
  readonly loading?: boolean;
  /** Test-Hook: forciert den initial open-state des Popovers. In
   *  jsdom + Radix-Popover triggert userEvent.click auf den Trigger
   *  nicht zuverlässig PointerEvents — Tests setzen defaultOpen=true,
   *  damit der Popover sofort gerendert ist. Production-Code lässt
   *  den Default (false). */
  readonly defaultOpen?: boolean;
};

export type ComboboxInputProps = ComboboxBaseProps &
  (
    | {
        readonly multiple?: false;
        readonly value: string;
        readonly onChange: (v: string) => void;
      }
    | {
        readonly multiple: true;
        readonly value: readonly string[];
        readonly onChange: (v: readonly string[]) => void;
      }
  );

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

// Debounce-Default lebt zentral (hooks/reference-limits.ts) damit
// app-weit ein consistentes Tipp-Window gilt.

// Substring-Filter für cmdk's Local-Mode. cmdk's Default ist
// `command-score` (fuzzy), das matcht "Ad" auch gegen "Backend" weil 'a'
// und 'd' irgendwo enthalten sind — für Reference-Lookups irreführend
// (User erwartet Prefix/Substring-Verhalten, nicht Subsequence-Match).
// Returns 1 wenn search im value enthalten, 0 sonst — cmdk hidet Items
// mit Score 0.
function substringFilter(value: string, search: string): number {
  return value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
}

export function ComboboxInput(props: ComboboxInputProps): ReactNode {
  const {
    id,
    name,
    options,
    disabled,
    required,
    hasError,
    placeholder,
    searchPlaceholder,
    emptyText,
    onSearchChange,
    loading,
    defaultOpen,
  } = props;
  // i18n-Defaults aus dem Framework-Bundle (kumikoDefaultTranslations).
  // Caller-Override gewinnt; Bundle-Override greift wenn der Caller
  // den Prop nicht setzt; raw-Key-Fallback wenn weder noch.
  const t = useTranslation();
  const effectivePlaceholder = placeholder ?? t("kumiko.combobox.placeholder");
  const effectiveSearchPlaceholder = searchPlaceholder ?? t("kumiko.combobox.search-placeholder");
  const effectiveEmptyText = emptyText ?? t("kumiko.combobox.empty");
  const loadingText = t("kumiko.combobox.loading");
  const multiple = props.multiple === true;
  const [open, setOpen] = useState(defaultOpen === true);
  // Local Search-Buffer für Remote-Mode. Tipps werden mit 300ms
  // Debounce an onSearchChange weitergereicht, damit pro Tastendruck
  // nicht ein Server-Roundtrip fliegt. Im Local-Mode ist das State
  // ungenutzt (cmdk steuert sein Search-Input intern).
  const [searchTerm, setSearchTerm] = useState("");
  const isRemote = onSearchChange !== undefined;
  useEffect(() => {
    if (!isRemote) return;
    const timer = setTimeout(() => onSearchChange(searchTerm), REFERENCE_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [isRemote, searchTerm, onSearchChange]);
  // Beim Schließen des Popovers den Suchbegriff zurücksetzen damit
  // beim nächsten Öffnen nicht der vorherige term hängt. Würde sonst
  // den Server-State stale halten zwischen Aufrufen.
  useEffect(() => {
    if (!open && searchTerm !== "") setSearchTerm("");
  }, [open, searchTerm]);
  // Discriminated-Union per `multiple`: TS narrowt props.value/onChange
  // automatisch — Runtime-Cast entfällt.
  const selectedValues = multiple ? new Set(props.value) : new Set<string>();
  const singleValue = !multiple ? props.value : "";
  const singleLabel = options.find((o) => o.value === singleValue)?.label ?? "";

  const toggleMulti = (v: string): void => {
    if (!multiple) return;
    const current = [...props.value];
    const idx = current.indexOf(v);
    if (idx >= 0) current.splice(idx, 1);
    else current.push(v);
    props.onChange(current);
  };

  const triggerLabel = multiple ? null : singleLabel === "" ? placeholder : singleLabel;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <input type="hidden" name={name} value={multiple ? props.value.join(",") : props.value} />
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
              <span className="text-muted-foreground">{effectivePlaceholder}</span>
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
          <Command shouldFilter={!isRemote} filter={substringFilter}>
            <div className="relative">
              <Command.Input
                placeholder={effectiveSearchPlaceholder}
                value={isRemote ? searchTerm : undefined}
                onValueChange={isRemote ? setSearchTerm : undefined}
                className="flex h-9 w-full border-0 border-b border-border bg-transparent px-3 py-1 text-sm outline-none placeholder:text-muted-foreground"
              />
              {loading === true && (
                <Loader2 className="absolute right-2 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
            <Command.List className="max-h-64 overflow-y-auto p-1">
              <Command.Empty className="py-3 text-center text-sm text-muted-foreground">
                {loading === true ? loadingText : effectiveEmptyText}
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
                      if (props.multiple === true) {
                        toggleMulti(opt.value);
                      } else {
                        props.onChange(opt.value);
                        setOpen(false);
                      }
                    }}
                    // Browser-Click-Bug Wurzel: `data-[disabled]:pointer-
                    // events-none` (vorher in der className) hat alle
                    // Mouse-Events absorbiert, weil cmdk das `data-disabled`
                    // attribute unter Bedingungen unerwartet setzt (z.B.
                    // bei filter-Score 0 in einigen cmdk-Versions). jsdom
                    // ignoriert Tailwind-CSS, daher der Test-blind-Spot —
                    // im Browser killte die Class lautlos jeden Click.
                    // Fix: data-[disabled]-Class komplett raus + explizit
                    // pointerEvents:auto als zusätzlicher Override.
                    style={{ pointerEvents: "auto" }}
                    className="relative flex cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none aria-selected:bg-accent aria-selected:text-accent-foreground"
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
