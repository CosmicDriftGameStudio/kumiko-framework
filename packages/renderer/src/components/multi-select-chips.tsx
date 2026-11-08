import type { ReactNode } from "react";
import type { EditFieldViewModel } from "../headless/index.ts";
import { usePrimitives } from "../primitives.tsx";
import { choiceChipClass } from "./choice-chip-class.ts";
import type { MultiSelectCheckboxOption } from "./multi-select-checkboxes.tsx";

// MultiSelectFieldDef's `display: "chips"`: every option is a toggle chip, ticked once chosen.
export function MultiSelectChips({
  field,
  id,
  options,
  value,
  onChange,
}: {
  readonly field: EditFieldViewModel;
  readonly id: string;
  readonly options: readonly MultiSelectCheckboxOption[];
  readonly value: readonly string[];
  readonly onChange: (value: readonly string[]) => void;
}): ReactNode {
  const { Button, Grid } = usePrimitives();
  const selected = new Set(value);
  // Emits in option order, like the checkbox grid, never in click order.
  const toggle = (optionValue: string): void => {
    const next = new Set(selected);
    if (!next.delete(optionValue)) next.add(optionValue);
    onChange(options.filter((opt) => next.has(opt.value)).map((opt) => opt.value));
  };
  return (
    <Grid columns="auto" tight ariaLabelledBy={`${id}-label`}>
      {options.map((opt) => {
        const isSelected = selected.has(opt.value);
        return (
          <Button
            key={opt.value}
            variant="secondary"
            size="sm"
            className={choiceChipClass(isSelected)}
            pressed={isSelected}
            disabled={field.readOnly === true || opt.disabled === true}
            testId={`${id}-chip-${opt.value}`}
            onClick={() => toggle(opt.value)}
          >
            {isSelected ? `✓ ${opt.label}` : opt.label}
          </Button>
        );
      })}
    </Grid>
  );
}
