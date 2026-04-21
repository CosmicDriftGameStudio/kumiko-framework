import type {
  BooleanFieldDef,
  DateFieldDef,
  EmbeddedFieldDef,
  EntityDefinition,
  FileFieldDef,
  FilesFieldDef,
  ImageFieldDef,
  ImagesFieldDef,
  LocatedTimestampFieldDef,
  MoneyFieldDef,
  NumberFieldDef,
  SelectFieldDef,
  TextFieldDef,
  TimestampFieldDef,
  TzFieldDef,
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

/**
 * UTC-Instant — für Ereignisse die zu einem bestimmten Zeitpunkt passieren
 * (createdAt, loginAt, actualPickupAt). Temporal.Instant intern.
 *
 * Mit `locatedBy: "<name>Tz"` wird das Feld zum Wall-Clock-Pair eines
 * Termins an einem Ort — bevorzuge dafür den `locatedTimestamp(name)`
 * Helper, der Pair + Marker atomar erzeugt.
 */
export function createTimestampField(
  overrides?: Partial<Omit<TimestampFieldDef, "type">>,
): TimestampFieldDef {
  return {
    type: "timestamp",
    required: false,
    ...overrides,
  };
}

/**
 * IANA-Zonenname (z.B. "Europe/Berlin"). Wird im Boot/Schema-Validator
 * via `Intl.supportedValuesOf("timeZone")` geprüft (kommt im Zod-Schritt).
 */
export function createTzField(overrides?: Partial<Omit<TzFieldDef, "type">>): TzFieldDef {
  return {
    type: "tz",
    required: false,
    ...overrides,
  };
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
export function createLocatedTimestampField(
  overrides?: Partial<Omit<LocatedTimestampFieldDef, "type">>,
): LocatedTimestampFieldDef {
  return {
    type: "locatedTimestamp",
    required: false,
    ...overrides,
  };
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
