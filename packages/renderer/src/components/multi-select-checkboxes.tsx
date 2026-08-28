import type { EditFieldViewModel } from "@cosmicdrift/kumiko-headless";
import type { ReactNode } from "react";
import { useTranslation } from "../i18n";
import { usePrimitives } from "../primitives";

export type MultiSelectCheckboxOption = {
  readonly value: string;
  readonly label: string;
};

export type MultiSelectCheckboxesProps = {
  readonly field: EditFieldViewModel;
  readonly id: string;
  readonly options: readonly MultiSelectCheckboxOption[];
  readonly value: readonly string[];
  readonly onChange: (value: readonly string[]) => void;
};

// Renders MultiSelectFieldDef's `display: "checkboxes"` mode — every option
// as a visible checkbox plus a select-all toggle, built purely from the
// platform-neutral Primitives contract (Grid/GridCell/Field/Input kind
// "boolean", the same primitive `case "boolean"` uses in render-field.tsx).
// No renderer-web import here — this file must stay usable from Expo too.
export function MultiSelectCheckboxes({
  field,
  id,
  options,
  value,
  onChange,
}: MultiSelectCheckboxesProps): ReactNode {
  const { Grid, GridCell, Field, Input, Button } = usePrimitives();
  const t = useTranslation();
  const disabled = field.readOnly;
  const selected = new Set(value);
  const allSelected = options.length > 0 && options.every((opt) => selected.has(opt.value));

  // Always emits in `field.options` order (MultiSelectFieldDef's documented
  // ordering guarantee), never in click/selection order.
  const emitOrdered = (next: ReadonlySet<string>): void => {
    onChange(options.filter((opt) => next.has(opt.value)).map((opt) => opt.value));
  };

  const toggleOption = (optionValue: string, checked: boolean): void => {
    const next = new Set(selected);
    if (checked) {
      next.add(optionValue);
    } else {
      next.delete(optionValue);
    }
    emitOrdered(next);
  };

  const toggleAll = (): void => {
    emitOrdered(allSelected ? new Set() : new Set(options.map((opt) => opt.value)));
  };

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={disabled}
        onClick={toggleAll}
        testId={`${id}-select-all`}
      >
        {allSelected
          ? t("kumiko.field.multiSelect.deselect-all")
          : t("kumiko.field.multiSelect.select-all")}
      </Button>
      <Grid
        columns={field.columns ?? 2}
        testId={`${id}-checkboxes`}
        {...(field.maxRows !== undefined && { maxRows: field.maxRows })}
      >
        {options.map((opt) => (
          <GridCell key={opt.value}>
            <Field id={`${id}-${opt.value}`} label={opt.label} layout="inline">
              <Input
                kind="boolean"
                id={`${id}-${opt.value}`}
                name={`${id}-${opt.value}`}
                value={selected.has(opt.value)}
                onChange={(checked) => toggleOption(opt.value, checked)}
                disabled={disabled}
              />
            </Field>
          </GridCell>
        ))}
      </Grid>
    </>
  );
}
