import type {
  BooleanFieldDef,
  DateFieldDef,
  EmbeddedFieldDef,
  EntityDefinition,
  FieldsMap,
  FileFieldDef,
  FilesFieldDef,
  ImageFieldDef,
  ImagesFieldDef,
  LocatedTimestampFieldDef,
  LongTextFieldDef,
  MoneyFieldDef,
  MultiSelectFieldDef,
  NumberFieldDef,
  SelectFieldDef,
  TextFieldDef,
  TimestampFieldDef,
  TzFieldDef,
} from "./types";

// Generic über `R extends true | false` (statt `boolean`) damit
// `createTextField({ required: true })` literal `required: true` im
// Return-Type behält. `boolean` würde widenen — DrizzleTable<E>'s
// Mapped-Type könnte dann nicht zwischen `required: true` und
// `required: false` dispatchen, jede Column würde zu nullable
// degradieren. Default `R = false` matcht den runtime-default. Pattern
// in jeder required-bearing factory unten.
export function createTextField<R extends true | false = false>(
  overrides?: Partial<Omit<TextFieldDef, "type" | "required">> & { required?: R },
): TextFieldDef & { required: R } {
  return {
    type: "text",
    maxLength: 200,
    required: false,
    searchable: false,
    sortable: false,
    ...overrides,
  } as TextFieldDef & { required: R };
}

/**
 * Long-form text field for source-code, markdown, blog-posts, email-
 * templates — anything that can be megabytes large. Type-level differs
 * from `text`: keine sortable/searchable/filterable/format options.
 * DB-mapping ist identisch zu text (PG text ist unbounded).
 *
 * Soft-cap default: kein maxLength (PG text ist 1 GB hart begrenzt).
 * Setze einen explicit `maxLength` wenn du ein verirrtes Browser-Paste
 * früh ablehnen willst (z.B. 1_000_000 = 1 MB).
 */
export function createLongTextField<R extends true | false = false>(
  overrides?: Partial<Omit<LongTextFieldDef, "type" | "required">> & { required?: R },
): LongTextFieldDef & { required: R } {
  return {
    type: "longText",
    required: false,
    ...overrides,
  } as LongTextFieldDef & { required: R };
}

export function createBooleanField<R extends true | false = false>(
  overrides?: Partial<Omit<BooleanFieldDef, "type" | "required">> & { required?: R },
): BooleanFieldDef & { required: R } {
  return {
    type: "boolean",
    required: false,
    default: false,
    ...overrides,
  } as BooleanFieldDef & { required: R };
}

export function createSelectField<
  const TOptions extends readonly string[],
  R extends true | false = false,
>(
  opts: { options: TOptions } & Partial<
    Omit<SelectFieldDef<TOptions>, "type" | "options" | "required">
  > & { required?: R },
): SelectFieldDef<TOptions> & { required: R } {
  return {
    type: "select",
    required: false,
    ...opts,
  } as SelectFieldDef<TOptions> & { required: R };
}

/**
 * Multi-Select-Field — N Werte aus einer festen Options-Liste.
 *
 * Storage: jsonb-Array<string>. Jeder Eintrag muss in `options` enthalten
 * sein (Boot-Validator). UI-Renderer rendert das als Checkbox-Group oder
 * Multi-Select-Dropdown.
 *
 * ```ts
 * licenceClasses: createMultiSelectField({
 *   options: ["B", "BE", "C", "C1", "CE", "C1E", "D", "D1"] as const,
 *   default: ["B"],
 * }),
 * ```
 *
 * Caller-API:
 *   Write: `{ licenceClasses: ["B", "BE", "C1"] }`
 *   Read:  `{ licenceClasses: ["B", "BE", "C1"] }`
 *
 * Wann statt `select`: wenn mehrere Werte gleichzeitig erlaubt sind.
 * Wann statt `embedded` mit Booleans: bei mehr als ~5 Optionen.
 */
export function createMultiSelectField<const TOptions extends readonly string[]>(
  opts: { options: TOptions } & Partial<Omit<MultiSelectFieldDef<TOptions>, "type" | "options">>,
): MultiSelectFieldDef<TOptions> {
  return {
    type: "multiSelect",
    required: false,
    ...opts,
  };
}

export function createNumberField<R extends true | false = false>(
  overrides?: Partial<Omit<NumberFieldDef, "type" | "required">> & { required?: R },
): NumberFieldDef & { required: R } {
  return {
    type: "number",
    required: false,
    ...overrides,
  } as NumberFieldDef & { required: R };
}

export function createMoneyField<R extends true | false = false>(
  overrides?: Partial<Omit<MoneyFieldDef, "type" | "required">> & { required?: R },
): MoneyFieldDef & { required: R } {
  return {
    type: "money",
    ...overrides,
  } as MoneyFieldDef & { required: R };
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

export function createDateField<R extends true | false = false>(
  overrides?: Partial<Omit<DateFieldDef, "type" | "required">> & { required?: R },
): DateFieldDef & { required: R } {
  return {
    type: "date",
    required: false,
    ...overrides,
  } as DateFieldDef & { required: R };
}

/**
 * UTC-Instant — für Ereignisse die zu einem bestimmten Zeitpunkt passieren
 * (createdAt, loginAt, actualPickupAt). Temporal.Instant intern.
 *
 * Mit `locatedBy: "<name>Tz"` wird das Feld zum Wall-Clock-Pair eines
 * Termins an einem Ort — bevorzuge dafür den `locatedTimestamp(name)`
 * Helper, der Pair + Marker atomar erzeugt.
 */
export function createTimestampField<R extends true | false = false>(
  overrides?: Partial<Omit<TimestampFieldDef, "type" | "required">> & { required?: R },
): TimestampFieldDef & { required: R } {
  // Object-Build vermeidet hartcodiertes `required: false` im literal —
  // das würde TS dazu bringen, R auf `boolean` zu widenen statt das
  // literal `true`/`false` aus dem overrides-Argument zu inferieren.
  return {
    ...overrides,
    type: "timestamp",
    required: (overrides?.required ?? false) as R,
  };
}

/**
 * IANA-Zonenname (z.B. "Europe/Berlin"). Wird im Boot/Schema-Validator
 * via `Intl.supportedValuesOf("timeZone")` geprüft (kommt im Zod-Schritt).
 */
export function createTzField<R extends true | false = false>(
  overrides?: Partial<Omit<TzFieldDef, "type" | "required">> & { required?: R },
): TzFieldDef & { required: R } {
  return {
    type: "tz",
    required: false,
    ...overrides,
  } as TzFieldDef & { required: R };
}

/**
 * Wall-Clock-Termin an einem Ort als ATOMARES Field. Empfohlene Form für
 * jeden Date-Wert mit Location-Bezug (Pickup, Delivery, Meeting, Schedule).
 *
 * EIN Schema-Feld → ZWEI DB-Spalten (`<name>_utc TIMESTAMPTZ` + `<name>_tz TEXT`)
 * → DREI API-Felder beim Read (`{ at, tz, utc }`).
 *
 * ```ts
 * r.entity("order", {
 *   fields: {
 *     pickup: createLocatedTimestampField(),
 *     delivery: createLocatedTimestampField(),
 *   },
 * });
 *
 * // Write — Caller schickt at+tz, Framework rechnet utc aus
 * await create({ pickup: { at: "2026-04-15T10:00:00", tz: "Europe/Lisbon" } });
 *
 * // Read — Framework liefert alle drei Felder zurück
 * // → { pickup: { at: "10:00", tz: "Europe/Lisbon", utc: "09:00Z" } }
 *
 * // Sort/Filter über die UTC-Spalte
 * orderBy(asc(orderTable.pickupUtc))
 * where(between(orderTable.pickupUtc, start, end))
 * ```
 *
 * Default-Sicht für `at` ist Pickup-Ort-lokal (was eingegeben wurde, kommt
 * mit demselben Tag zurück). User-lokale Sicht kommt aus `utc` per
 * separater Berechnung.
 */
export function createLocatedTimestampField<R extends true | false = false>(
  overrides?: Partial<Omit<LocatedTimestampFieldDef, "type" | "required">> & { required?: R },
): LocatedTimestampFieldDef & { required: R } {
  return {
    type: "locatedTimestamp",
    required: false,
    ...overrides,
  } as LocatedTimestampFieldDef & { required: R };
}

/**
 * @deprecated Verwende stattdessen `createLocatedTimestampField()` —
 * EIN Field-Type statt zwei lose Pair-Felder. Migration: ersetze
 * `...locatedTimestamp("pickup")` durch `pickup: createLocatedTimestampField()`.
 *
 * Wall-Clock-Termin an einem Ort — Helper der ZWEI verbundene Felder
 * erzeugt. Bevorzugte Form für jeden Date-Wert mit Location-Bezug
 * (Pickup, Delivery, Meeting, Schedule).
 *
 * ```ts
 * r.entity("order", {
 *   fields: {
 *     ...locatedTimestamp("pickup"),    // → pickupAt + pickupTz
 *     ...locatedTimestamp("delivery"),  // → deliveryAt + deliveryTz
 *   },
 * });
 * ```
 *
 * Zur Laufzeit wird:
 * - DB: `<name>_at TIMESTAMPTZ` (UTC) + `<name>_tz TEXT` (IANA-Name)
 * - JSON: `{ <name>At: "2026-04-03T10:00:00", <name>Tz: "Europe/Lisbon" }`
 *   (Wall-Clock OHNE Offset, plus IANA-Name — zwei getrennte Felder)
 * - Reducer/Apply: kann mit Temporal.ZonedDateTime arbeiten
 *
 * Optionen pro Feld (z.B. `required` auf den At-Teil) per zweitem Argument.
 */
export function locatedTimestamp(
  name: string,
  overrides?: { readonly required?: boolean; readonly access?: TimestampFieldDef["access"] },
): Readonly<Record<string, TimestampFieldDef | TzFieldDef>> {
  const atName = `${name}At`;
  const tzName = `${name}Tz`;
  return {
    [atName]: {
      type: "timestamp",
      locatedBy: tzName,
      required: overrides?.required,
      access: overrides?.access,
    },
    [tzName]: {
      type: "tz",
      required: overrides?.required,
      access: overrides?.access,
    },
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

// `F` läuft OHNE Constraint im Generic-Param damit TS die literal-types
// einzelner Field-Defs durchzieht (required: true bleibt true, nicht
// boolean). Constraint-Match gegen FieldsMap würde widenen — siehe TS-
// Issue um Constraint-Inferenz auf strukturellen Records. Stattdessen
// validieren wir die Conformance via conditional return type: wenn F
// nicht FieldsMap-compat ist, kollabiert der Return zu `never`.
export function createEntity<F>(def: {
  readonly table?: string;
  readonly fields: F;
  readonly softDelete?: boolean;
  readonly searchWeight?: number;
  readonly defaultCurrency?: string;
  readonly transitions?: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
  readonly indexes?: readonly {
    readonly columns: readonly [string, ...string[]];
    readonly unique?: boolean;
    readonly name?: string;
  }[];
  readonly idType?: "serial" | "uuid";
  readonly access?: EntityDefinition["access"];
}): F extends FieldsMap ? EntityDefinition<F> : never {
  return {
    softDelete: false,
    searchWeight: 1,
    // Default to UUID — post-ES-pivot every entity is event-sourced and
    // aggregate-ids are UUID. Opt-out with `idType: "serial"` for pre-ES
    // legacy tables (should be rare).
    ...def,
  } as F extends FieldsMap ? EntityDefinition<F> : never;
}
