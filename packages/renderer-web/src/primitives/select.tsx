// shadcn-style Select gebaut auf @radix-ui/react-select. Pattern ist
// das Standard-Setup das man im shadcn-Code-Generator bekommt: Trigger
// (Button-style mit Chevron rechts), Portal'd Content (Popover), Items
// mit Check-Indicator.
//
// Default-Variante des SelectInput-Primitives. Apps die was eigenes
// rendern wollen (Custom-Search, Multi-Select), reichen über
// PrimitivesProvider eine eigene Input-Komponente rein.

import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export type SelectInputProps = {
  readonly id: string;
  readonly name: string;
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly options: readonly string[];
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly hasError?: boolean;
  readonly placeholder?: string;
};

const triggerClass =
  "flex h-9 w-full items-center justify-between rounded-md border border-input " +
  "bg-transparent px-3 py-1 text-sm shadow-sm transition-colors " +
  "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 " +
  "focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 " +
  "[&>span]:line-clamp-1";

const contentClass =
  "relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border bg-popover " +
  "text-popover-foreground shadow-md data-[state=open]:animate-in " +
  "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 " +
  "data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 " +
  "data-[state=open]:zoom-in-95";

const itemClass =
  "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 " +
  "text-sm outline-none focus:bg-accent focus:text-accent-foreground " +
  "data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

export function SelectInput({
  id,
  name,
  value,
  onChange,
  options,
  disabled,
  required,
  hasError,
  placeholder = "—",
}: SelectInputProps): ReactNode {
  // Radix Select speichert State intern via value-Prop. value="" wird
  // von Radix als „nichts gewählt" interpretiert UND als Placeholder
  // gerendert — exakt das was wir wollen für nicht-required Felder mit
  // leerem Initial-Wert.
  return (
    <SelectPrimitive.Root
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      // Radix nutzt das nur für hidden-input + Form-validation; unsere
      // Form ist React-state-driven, aber wir reichen's durch für
      // Browser-Native-Required-Behavior.
      required={required}
      name={name}
    >
      <SelectPrimitive.Trigger
        id={id}
        aria-required={required}
        aria-invalid={hasError === true ? true : undefined}
        className={cn(
          triggerClass,
          hasError === true && "border-destructive focus-visible:ring-destructive",
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="h-4 w-4 opacity-50" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className={cn(contentClass, "data-[side=bottom]:translate-y-1")}
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((opt) => (
              <SelectPrimitive.Item key={opt} value={opt} className={itemClass}>
                <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                  <SelectPrimitive.ItemIndicator>
                    <Check className="h-4 w-4" />
                  </SelectPrimitive.ItemIndicator>
                </span>
                <SelectPrimitive.ItemText>{opt}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
