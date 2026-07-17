import type {
  BigIntFieldDef,
  BooleanFieldDef,
  DateFieldDef,
  DecimalFieldDef,
  DerivedFieldDef,
  EmbeddedFieldDef,
  EntityDefinition,
  EntityIndexDef,
  FieldsMap,
  FileFieldDef,
  FilesFieldDef,
  ImageFieldDef,
  ImagesFieldDef,
  JsonbFieldDef,
  LocatedTimestampFieldDef,
  LongTextFieldDef,
  MoneyFieldDef,
  MultiSelectFieldDef,
  NumberFieldDef,
  RetentionDef,
  SelectFieldDef,
  TextFieldDef,
  TimestampFieldDef,
  TzFieldDef,
} from "./types";

// Generic über `R extends true | false` (statt `boolean`) damit
// `createTextField({ required: true })` literal `required: true` im
// Return-Type behält. `boolean` würde widenen — EntityTable<E>'s
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
  } as TextFieldDef & { required: R }; // @cast-boundary engine-payload
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
/**
 * Read-time computed field for `EntityDefinition.derivedFields` (NOT `fields`).
 * The value is derived per row from the stored columns + the clock at query
 * time, never persisted. Display only — server-side sort/filter/search don't
 * apply and there's no client-side sort path (see DerivedFieldDef). `derive`
 * must take its clock from `ctx.asOf`, never `Temporal.Now`/`Date`.
 */
export function createDerivedField(spec: DerivedFieldDef): DerivedFieldDef {
  return { ...spec };
}

export function createLongTextField<R extends true | false = false>(
  overrides?: Partial<Omit<LongTextFieldDef, "type" | "required">> & { required?: R },
): LongTextFieldDef & { required: R } {
  return {
    type: "longText",
    required: false,
    ...overrides,
  } as LongTextFieldDef & { required: R }; // @cast-boundary engine-payload
}

export function createBooleanField<R extends true | false = false>(
  overrides?: Partial<Omit<BooleanFieldDef, "type" | "required">> & { required?: R },
): BooleanFieldDef & { required: R } {
  return {
    type: "boolean",
    required: false,
    default: false,
    ...overrides,
  } as BooleanFieldDef & { required: R }; // @cast-boundary engine-payload
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
  } as SelectFieldDef<TOptions> & { required: R }; // @cast-boundary engine-payload
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

/**
 * Numeric field — `double precision` column by default (fractional values
 * allowed end to end). Pass `integer: true` for a 32-bit `integer` column
 * with `.int()` write-boundary validation. Need exact decimal storage
 * instead (money-adjacent math)? Use `createDecimalField` (`numeric`).
 */
export function createNumberField<R extends true | false = false>(
  overrides?: Partial<Omit<NumberFieldDef, "type" | "required">> & { required?: R },
): NumberFieldDef & { required: R } {
  return {
    type: "number",
    required: false,
    ...overrides,
  } as NumberFieldDef & { required: R }; // @cast-boundary engine-payload
}

export function createBigIntField<R extends true | false = false>(
  overrides?: Partial<Omit<BigIntFieldDef, "type" | "required">> & { required?: R },
): BigIntFieldDef & { required: R } {
  return {
    type: "bigInt",
    required: false,
    ...overrides,
  } as BigIntFieldDef & { required: R }; // @cast-boundary engine-payload
}

// Exact decimal column — numeric(precision, scale). precision/scale are
// required (no truncating default). See DecimalFieldDef for the precision
// caveat (surfaced as JS number, safe ≤ 2^53).
export function createDecimalField<R extends true | false = false>(
  config: { precision: number; scale: number } & Partial<
    Omit<DecimalFieldDef, "type" | "precision" | "scale" | "required">
  > & { required?: R },
): DecimalFieldDef & { required: R } {
  // Fail at definition time, not at the first migration: numeric(p,s) requires
  // integer p ≥ 1 and 0 ≤ s ≤ p (Postgres rejects e.g. numeric(2,4), and the
  // schema-builder's `10 ** (precision - scale)` bound goes nonsensical).
  const { precision, scale } = config;
  if (
    !Number.isInteger(precision) ||
    !Number.isInteger(scale) ||
    precision < 1 ||
    scale < 0 ||
    scale > precision
  ) {
    throw new Error(
      `createDecimalField: precision/scale must be integers with precision ≥ 1 and ` +
        `0 ≤ scale ≤ precision, got precision=${precision}, scale=${scale}`,
    );
  }
  return {
    type: "decimal",
    required: false,
    ...config,
  } as DecimalFieldDef & { required: R }; // @cast-boundary engine-payload
}

export function createMoneyField<R extends true | false = false>(
  overrides?: Partial<Omit<MoneyFieldDef, "type" | "required">> & { required?: R },
): MoneyFieldDef & { required: R } {
  return {
    type: "money",
    ...overrides,
  } as MoneyFieldDef & { required: R }; // @cast-boundary engine-payload
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

// Free-form jsonb-Spalte — siehe `JsonbFieldDef`-Doku. Schema-less, default
// `{}`, NOT NULL. Hauptnutzer: custom-fields-Bundle (host-entity's
// `customFields`-Spalte). Andere valid uses: tenant-config-blobs, AI-
// inferred-metadata, future tags-arrays.
export function createJsonbField(overrides?: Partial<Omit<JsonbFieldDef, "type">>): JsonbFieldDef {
  return {
    type: "jsonb",
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
  } as DateFieldDef & { required: R }; // @cast-boundary engine-payload
}

/**
 * UTC-Instant — für Ereignisse die zu einem bestimmten Zeitpunkt passieren
 * (createdAt, loginAt, actualPickupAt). Temporal.Instant intern.
 *
 * Mit `locatedBy: "<name>Tz"` wird das Feld zum Wall-Clock-Pair eines
 * Termins an einem Ort — bevorzuge dafür `createLocatedTimestampField()`,
 * das EIN atomares Feld statt eines lose verdrahteten Pairs erzeugt.
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
    required: (overrides?.required ?? false) as R, // @cast-boundary engine-payload
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
  } as TzFieldDef & { required: R }; // @cast-boundary engine-payload
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
  } as LocatedTimestampFieldDef & { required: R }; // @cast-boundary engine-payload
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
  /** Event stream lives on SYSTEM_TENANT_ID (tenant-independent aggregate, e.g.
   *  user) instead of the creator's tenant. See EntityDefinition.systemStream. */
  readonly systemStream?: boolean;
  readonly searchWeight?: number;
  readonly defaultCurrency?: string;
  readonly transitions?: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
  readonly indexes?: readonly EntityIndexDef[];
  readonly idType?: "serial" | "uuid";
  readonly access?: EntityDefinition["access"];
  readonly retention?: RetentionDef;
  readonly derivedFields?: EntityDefinition["derivedFields"];
}): F extends FieldsMap ? EntityDefinition<F> : never {
  return {
    softDelete: false,
    searchWeight: 1,
    // Default to UUID — post-ES-pivot every entity is event-sourced and
    // aggregate-ids are UUID. Opt-out with `idType: "serial"` for pre-ES
    // legacy tables (should be rare).
    ...def,
  } as F extends FieldsMap ? EntityDefinition<F> : never; // @cast-boundary engine-payload
}
