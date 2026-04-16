// --- Field Types ---

export type FieldAccess = {
  readonly read?: readonly string[];
  readonly write?: readonly string[];
};

export type TextFieldDef = {
  readonly type: "text";
  readonly maxLength?: number;
  readonly required?: boolean;
  readonly searchable?: boolean;
  readonly sortable?: boolean;
  readonly encrypted?: boolean;
  readonly format?: "email" | "url" | "phone";
  readonly default?: string;
  readonly access?: FieldAccess;
};

export type BooleanFieldDef = {
  readonly type: "boolean";
  readonly required?: boolean;
  readonly default?: boolean;
  readonly access?: FieldAccess;
};

export type SelectFieldDef<TOptions extends readonly string[] = readonly string[]> = {
  readonly type: "select";
  readonly options: TOptions;
  readonly required?: boolean;
  readonly default?: TOptions[number];
  readonly access?: FieldAccess;
};

export type NumberFieldDef = {
  readonly type: "number";
  readonly required?: boolean;
  readonly default?: number;
  readonly access?: FieldAccess;
};

export type MoneyFieldDef = {
  readonly type: "money";
  readonly required?: boolean;
  readonly access?: FieldAccess;
};

// --- Currency ---

export const DEFAULT_CURRENCIES = [
  "EUR",
  "USD",
  "GBP",
  "CHF",
  "JPY",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "CZK",
  "CAD",
  "AUD",
  "NZD",
  "CNY",
  "INR",
] as const;

export type DefaultCurrency = (typeof DEFAULT_CURRENCIES)[number];

// --- Embedded Object ---

export type EmbeddedSubFieldDef = {
  readonly type: "text" | "number" | "boolean" | "date";
  readonly required?: boolean;
  readonly searchable?: boolean;
  readonly access?: FieldAccess;
};

export type EmbeddedFieldDef = {
  readonly type: "embedded";
  readonly required?: boolean;
  readonly schema: Readonly<Record<string, EmbeddedSubFieldDef>>;
  readonly access?: FieldAccess;
};

export type DateFieldDef = {
  readonly type: "date";
  readonly required?: boolean;
  readonly access?: FieldAccess;
};

export type FileFieldDef = {
  readonly type: "file";
  readonly maxSize?: string;
  readonly accept?: readonly string[];
  readonly access?: FieldAccess;
};

export type ImageFieldDef = {
  readonly type: "image";
  readonly maxSize?: string;
  readonly accept?: readonly string[];
  readonly thumbnails?: boolean;
  readonly access?: FieldAccess;
};

export type FilesFieldDef = {
  readonly type: "files";
  readonly maxSize?: string;
  readonly accept?: readonly string[];
  readonly maxCount?: number;
  readonly access?: FieldAccess;
};

export type ImagesFieldDef = {
  readonly type: "images";
  readonly maxSize?: string;
  readonly accept?: readonly string[];
  readonly maxCount?: number;
  readonly thumbnails?: boolean;
  readonly access?: FieldAccess;
};

export type FieldDefinition =
  | TextFieldDef
  | BooleanFieldDef
  | SelectFieldDef
  | NumberFieldDef
  | MoneyFieldDef
  | EmbeddedFieldDef
  | DateFieldDef
  | FileFieldDef
  | ImageFieldDef
  | FilesFieldDef
  | ImagesFieldDef;

// --- Entity ---

// --- State Transitions ---

export type TransitionMap = Readonly<Record<string, readonly string[]>>;

export type EntityDefinition = {
  readonly table?: string;
  readonly fields: Readonly<Record<string, FieldDefinition>>;
  readonly softDelete?: boolean;
  readonly searchWeight?: number;
  readonly defaultCurrency?: string;
  /** Allowed state transitions per field. Boot validates against select options. */
  readonly transitions?: Readonly<Record<string, TransitionMap>>;
  /**
   * PK-Typ der Entity.
   * - `"serial"` (default): bigserial integer — schneller, kompakter, perfekt für klassische CRUD-Entities.
   * - `"uuid"`: uuid mit `gen_random_uuid()` default — verpflichtend für Entities deren `id` als
   *   Foreign-Key-Wert in multi-tenant Kontexten reist (z.B. `tenant.id` IS der `tenantId`). Auch für
   *   ES-Aggregate (Phase 2+) notwendig, da Events per UUID aggregiert werden.
   */
  readonly idType?: "serial" | "uuid";
};
