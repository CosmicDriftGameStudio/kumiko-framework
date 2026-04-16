import type {
  BooleanFieldDef,
  DateFieldDef,
  EmbeddedFieldDef,
  EntityDefinition,
  FileFieldDef,
  FilesFieldDef,
  ImageFieldDef,
  ImagesFieldDef,
  MoneyFieldDef,
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

export function createMoneyField(overrides?: Partial<Omit<MoneyFieldDef, "type">>): MoneyFieldDef {
  return {
    type: "money",
    ...overrides,
  };
}

export function createEmbeddedField(
  schema: EmbeddedFieldDef["schema"],
  overrides?: Partial<Omit<EmbeddedFieldDef, "type" | "schema">>,
): EmbeddedFieldDef {
  return {
    type: "embedded",
    schema,
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

export function createFileField(overrides?: Partial<Omit<FileFieldDef, "type">>): FileFieldDef {
  return { type: "file", ...overrides };
}

export function createImageField(overrides?: Partial<Omit<ImageFieldDef, "type">>): ImageFieldDef {
  return { type: "image", ...overrides };
}

export function createFilesField(overrides?: Partial<Omit<FilesFieldDef, "type">>): FilesFieldDef {
  return { type: "files", ...overrides };
}

export function createImagesField(
  overrides?: Partial<Omit<ImagesFieldDef, "type">>,
): ImagesFieldDef {
  return { type: "images", ...overrides };
}

export function createEntity(
  def: Omit<EntityDefinition, "softDelete" | "searchWeight"> & {
    softDelete?: boolean;
    searchWeight?: number;
  },
): EntityDefinition {
  return {
    softDelete: false,
    searchWeight: 1,
    // Default to UUID — post-ES-pivot every entity is event-sourced and
    // aggregate-ids are UUID. Opt-out with `idType: "serial"` for pre-ES
    // legacy tables (should be rare).
    idType: "uuid",
    ...def,
  };
}
