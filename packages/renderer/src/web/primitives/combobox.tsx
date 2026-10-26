// Searchable Select / Combobox.
//
// The pattern follows the shadcn standard: a popover trigger rendered as a
// button showing the current value or placeholder, with a popover containing
// a cmdk command with a search input and filterable item list.
//
// cmdk provides client-side fuzzy matching through `Command.Filter` by
// default. Server-side remote search with a debounced query is not included
// in the MVP and can be enabled later as a separate mode.
//
// Multi-mode: `multiple: true` switches to tag display and multi-selection.
// Selected values render as small chips, while the search input remains open
// for additional selections.

import { Command } from "cmdk";
import { Check, ChevronDown, Loader2, Plus } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { type ReactNode, useEffect, useState } from "react";
import { REFERENCE_SEARCH_DEBOUNCE_MS, useTranslation } from "../../index.ts";
import { cn } from "../lib/cn.ts";
import { groupOptions } from "./option-groups.ts";

export type ComboboxOption = {
  readonly value: string;
  readonly label: string;
  /** Muted second line in the list item; also matched by the local search. */
  readonly description?: string;
  /** Group heading; see `groupOptions` for the ordering rule. */
  readonly group?: string;
  /** Visible but not choosable. */
  readonly disabled?: boolean;
};

// The discriminated union ties `multiple` to the value and onChange types:
// single mode uses a string, while multi-mode uses string[]. The caller must
// choose the mode at build time so TypeScript enforces the matching signature
// without a runtime narrowing cast.
type ComboboxBaseProps = {
  readonly id: string;
  readonly name: string;
  readonly options: readonly ComboboxOption[];
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly hasError?: boolean;
  readonly ariaLabel?: string;
  readonly placeholder?: string;
  readonly searchPlaceholder?: string;
  readonly emptyText?: string;
  /** When set, enables remote search. cmdk's client-side filter is disabled
   * because the server has already filtered the results, and the search input
   * invokes onSearchChange with a 300ms debounce. Without this callback,
   * filtering remains local using cmdk's fuzzy matching on the loaded options.
   */
  readonly onSearchChange?: (q: string) => void;
  /** Shows a spinner in the trigger and popover footer while remote search is
   * in progress. */
  readonly loading?: boolean;
  /** Fixed footer row below the option list ("+ createLabel"). Rendered
   *  unfiltered — stays visible even when the search matches nothing,
   *  which is the most common case for reference-lookups on a freshly
   *  seeded system. Omit for the plain
   *  select-existing combobox. */
  readonly onCreate?: () => void;
  /** Label for the create-footer row. Default: i18n `kumiko.actions.create`. */
  readonly createLabel?: string;
  /** Test hook that controls the popover's initial open state. In jsdom with
   * Radix Popover, userEvent.click does not reliably trigger PointerEvents;
   * tests set defaultOpen=true so the popover is rendered immediately.
   * Production code leaves the default as false. */
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
  "flex h-9 w-full min-w-0 items-center justify-between gap-2 " +
  "rounded-md border border-input text-left max-md:min-h-11 " +
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

// The debounce default is centralized in hooks/reference-limits.ts so the
// same typing interval applies throughout the app.

// Substring filter for cmdk's local mode. cmdk's default is
// `command-score` (fuzzy), which matches "Ad" against "Backend" because 'a'
// and 'd' occur somewhere in the text. That is misleading for reference
// lookups, where users expect prefix or substring matching rather than
// subsequence matching.
// Returns 1 when search occurs in value or keywords, and 0 otherwise;
// cmdk hides items with a score of 0.
function substringFilter(value: string, search: string, keywords?: string[]): number {
  const needle = search.toLowerCase();
  return [value, ...(keywords ?? [])].some((text) => text.toLowerCase().includes(needle)) ? 1 : 0;
}

export function ComboboxInput(props: ComboboxInputProps): ReactNode {
  const {
    id,
    name,
    options,
    disabled,
    required,
    hasError,
    ariaLabel,
    placeholder,
    searchPlaceholder,
    emptyText,
    onSearchChange,
    loading,
    defaultOpen,
    onCreate,
    createLabel,
  } = props;
  // i18n defaults come from the framework bundle (kumikoDefaultTranslations).
  // A caller override takes precedence, followed by the bundle override;
  // the raw key is used only when neither is available.
  const t = useTranslation();
  const effectivePlaceholder = placeholder ?? t("kumiko.combobox.placeholder");
  const effectiveSearchPlaceholder = searchPlaceholder ?? t("kumiko.combobox.search-placeholder");
  const effectiveEmptyText = emptyText ?? t("kumiko.combobox.empty");
  const loadingText = t("kumiko.combobox.loading");
  const effectiveCreateLabel = createLabel ?? t("kumiko.actions.create");
  const multiple = props.multiple === true;
  const [open, setOpen] = useState(defaultOpen === true);
  // Local search buffer for remote mode. Keystrokes are passed to
  // onSearchChange after a 300ms debounce, avoiding a server round-trip for
  // every keystroke. In local mode, this state is unused because cmdk
  // controls its search input internally.
  const [searchTerm, setSearchTerm] = useState("");
  const isRemote = onSearchChange !== undefined;
  useEffect(() => {
    if (!isRemote) return;
    const timer = setTimeout(() => onSearchChange(searchTerm), REFERENCE_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [isRemote, searchTerm, onSearchChange]);
  // Reset the search term when the popover closes so the next opening does not
  // retain the previous term and leave the server state stale between uses.
  useEffect(() => {
    if (!open && searchTerm !== "") setSearchTerm("");
  }, [open, searchTerm]);
  // The discriminated union lets TypeScript narrow props.value and onChange
  // automatically, so no runtime cast is needed.
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
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={!multiple && singleLabel !== "" ? singleLabel : undefined}
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
              // Tags are read-only because the trigger is a <button> and cannot contain a
              // nested <button>. Removing a value therefore requires selecting
              // it again in the combobox popup, where the item toggle deselects
              // the corresponding option.
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
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-left",
              singleLabel === "" && "text-muted-foreground",
            )}
          >
            {triggerLabel}
          </span>
        )}
        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
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
              {groupOptions(options).map((section) => {
                const items = section.options.map((opt) => {
                  const isSelected = multiple
                    ? selectedValues.has(opt.value)
                    : opt.value === singleValue;
                  return (
                    <Command.Item
                      key={opt.value}
                      data-testid={`combobox-${id}-option-${opt.value}`}
                      value={opt.label}
                      keywords={opt.description !== undefined ? [opt.description] : undefined}
                      disabled={opt.disabled}
                      onSelect={() => {
                        if (props.multiple === true) {
                          toggleMulti(opt.value);
                        } else {
                          props.onChange(opt.value);
                          setOpen(false);
                        }
                      }}
                      // No pointer-events toggles on the item: with Tailwind active,
                      // `data-[disabled]:pointer-events-none` silently swallowed mouse
                      // clicks (keyboard select still worked, jsdom tests stayed green).
                      className={cn(
                        "relative flex cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none aria-selected:bg-accent aria-selected:text-accent-foreground",
                        opt.disabled === true && "cursor-not-allowed opacity-50",
                      )}
                    >
                      {isSelected && (
                        <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                          <Check className="h-4 w-4" />
                        </span>
                      )}
                      <span className="flex min-w-0 flex-col">
                        <span>{opt.label}</span>
                        {opt.description !== undefined && (
                          <span className="text-xs text-muted-foreground">{opt.description}</span>
                        )}
                      </span>
                    </Command.Item>
                  );
                });
                return section.heading === undefined ? (
                  items
                ) : (
                  <Command.Group
                    key={section.heading}
                    heading={section.heading}
                    className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
                  >
                    {items}
                  </Command.Group>
                );
              })}
            </Command.List>
            {onCreate !== undefined && (
              <button
                type="button"
                data-testid={`combobox-${id}-create`}
                onClick={() => {
                  setOpen(false);
                  onCreate();
                }}
                className="flex w-full cursor-pointer select-none items-center gap-2 border-t border-border px-3 py-1.5 text-left text-sm text-primary outline-none hover:bg-accent hover:text-accent-foreground"
              >
                <Plus className="h-4 w-4" />
                <span>{effectiveCreateLabel}</span>
              </button>
            )}
          </Command>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
