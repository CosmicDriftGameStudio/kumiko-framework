import type {
  BooleanFieldDef,
  DateFieldDef,
  EntityDefinition,
  NumberFieldDef,
  SelectFieldDef,
  TextFieldDef,
} from "./types";

export function createTextField(overrides?: Partial<Omit<TextFieldDef, "type">>): TextFieldDef {
  return {
    type: "text",
    maxLength: 200,
    required: false,
    searchable: false,
    sortable: false,
    ...overrides,
  };
}

export function createBooleanField(
  overrides?: Partial<Omit<BooleanFieldDef, "type">>,
): BooleanFieldDef {
  return {
    type: "boolean",
    required: false,
    default: false,
    ...overrides,
  };
}

export function createSelectField<const TOptions extends readonly string[]>(
  opts: { options: TOptions } & Partial<Omit<SelectFieldDef<TOptions>, "type" | "options">>,
): SelectFieldDef<TOptions> {
  return {
    type: "select",
    required: false,
    ...opts,
  };
}

export function createNumberField(
  overrides?: Partial<Omit<NumberFieldDef, "type">>,
): NumberFieldDef {
  return {
    type: "number",
    required: false,
    ...overrides,
  };
}

export function createDateField(overrides?: Partial<Omit<DateFieldDef, "type">>): DateFieldDef {
  return {
    type: "date",
    required: false,
    ...overrides,
  };
}

export function createEntity(
  def: Omit<EntityDefinition, "softDelete"> & { softDelete?: boolean },
): EntityDefinition {
  return {
    softDelete: false,
    ...def,
  };
}
