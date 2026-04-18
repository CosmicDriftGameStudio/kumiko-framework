// --- Field Types ---

export type FieldAccess = {
  readonly read?: readonly string[];
  readonly write?: readonly string[];
};

// `sensitive: true` — the field's value is excluded from event payloads
// (create data, update changes/previous, delete/restore previous). The entity
// row still stores it; only the immutable event-log won't. Use for data that
// must never land in permanent history: password hashes, API tokens,
// unhashed PII, bank details, tax IDs. The trade-off: event-replay and
// custom projections cannot read sensitive field values. See
// docs/plans/architecture/projections.md.

export type TextFieldDef = {
  readonly type: "text";
  readonly maxLength?: number;
  readonly required?: boolean;
  readonly searchable?: boolean;
  readonly sortable?: boolean;
  readonly encrypted?: boolean;
  readonly sensitive?: boolean;
  readonly format?: "email" | "url" | "phone";
  readonly default?: string;
  readonly access?: FieldAccess;
};

export type BooleanFieldDef = {
  readonly type: "boolean";
  readonly required?: boolean;
  readonly sensitive?: boolean;
  readonly default?: boolean;
  readonly access?: FieldAccess;
};

export type SelectFieldDef<TOptions extends readonly string[] = readonly string[]> = {
  readonly type: "select";
  readonly options: TOptions;
  readonly required?: boolean;
  readonly sensitive?: boolean;
  readonly default?: TOptions[number];
  readonly access?: FieldAccess;
};

export type NumberFieldDef = {
  readonly type: "number";
  readonly required?: boolean;
  readonly sensitive?: boolean;
  readonly default?: number;
  readonly access?: FieldAccess;
};

export type MoneyFieldDef = {
  readonly type: "money";
  readonly required?: boolean;
  readonly sensitive?: boolean;
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
  readonly sensitive?: boolean;
  readonly schema: Readonly<Record<string, EmbeddedSubFieldDef>>;
  readonly access?: FieldAccess;
};

// Legacy "date" — JS-Date-Object, semantisch unklar (Wall-Clock vs Instant).
// Für neue Felder bevorzuge:
//   - `timestamp` für UTC-Instant ("wann ist das passiert")
//   - `locatedTimestamp(name)` Helper für Termine die an einem Ort
//     stattfinden ("Pickup um 10:00 in Lissabon")
//   - (kommt) `plainDate` für Kalender-Daten ohne Uhrzeit (z.B. Geburtstag)
// Siehe docs/plans/architecture/timezones.md
export type DateFieldDef = {
  readonly type: "date";
  readonly required?: boolean;
  readonly sensitive?: boolean;
  readonly access?: FieldAccess;
};

// UTC-Instant (Temporal.Instant). Für Ereignisse die zu einem bestimmten
// Augenblick passieren, ohne Location-Bezug: createdAt, loginAt, actualPickupAt.
// JSON-Form: ISO-UTC-String "2026-04-18T10:00:00Z" via .toJSON().
//
// Mit `locatedBy: "<name>Tz"` markiert: bildet ein Wall-Clock+TZ-Pair mit dem
// referenzierten tz-Feld. JSON-Form wird dann zwei Felder ({ at, tz }), DB
// speichert Wall-Clock+tz und konvertiert transparent (siehe DB-Wrapper,
// kommt in einer späteren Iteration).
//
// Verwendung über den `locatedTimestamp(name)` Helper, der das Pair atomar
// erzeugt und die Marker korrekt verdrahtet.
export type TimestampFieldDef = {
  readonly type: "timestamp";
  readonly required?: boolean;
  readonly sensitive?: boolean;
  readonly access?: FieldAccess;
  /**
   * Marker: dieses Timestamp-Feld ist Wall-Clock-Zeit an einem Ort.
   * Wert ist der Name des begleitenden tz-Felds (IANA-Zone).
   *
   * Beispiel: `locatedTimestamp("pickup")` erzeugt
   *   { pickupAt: { type: "timestamp", locatedBy: "pickupTz" }, pickupTz: { type: "tz" } }
   */
  readonly locatedBy?: string;
};

// IANA-Zonenname (z.B. "Europe/Berlin", "America/Los_Angeles").
// Wird via `Intl.supportedValuesOf("timeZone")` validiert (kommt im
// Zod-Validator-Schritt). Eigener Field-Typ damit Type-Safety + Storage
// (TEXT-Spalte) korrekt sind und der `locatedBy`-Marker eindeutig auflöst.
export type TzFieldDef = {
  readonly type: "tz";
  readonly required?: boolean;
  readonly sensitive?: boolean;
  readonly access?: FieldAccess;
};

// Wall-Clock-Termin an einem Ort als ATOMARES Konzept.
// EIN Feld in der Schema-Definition, ZWEI Spalten in der DB
// (`<name>_utc TIMESTAMPTZ` + `<name>_tz TEXT`), DREI Felder im API-Object
// ({ at, tz, utc }). Drizzle-Wrapper macht die Konvertierung transparent —
// Feature-Code sieht das 3-Felder-Object beim Read und schreibt
// { at, tz } beim Insert (utc wird berechnet).
//
// API-Form:
//   Write: { at: "2026-04-15T10:00:00", tz: "Europe/Lisbon" }
//   Read:  { at: "2026-04-15T10:00:00", tz: "Europe/Lisbon", utc: "2026-04-15T09:00:00Z" }
//
// Default-Sicht für `at`: Wall-Clock am Ort (`tz`). Wer User-lokale Sicht
// will, projeziert `utc` separat per ctx.tz.fromInstantInZone(utc, userTz).
//
// Ersetzt das alte `locatedTimestamp(name)` Helper-Pattern (zwei separate
// Pair-Felder). Sauberer Single-Field-Typ + Auto-Convert-Logik.
//
// Siehe docs/plans/architecture/timezones.md.
export type LocatedTimestampFieldDef = {
  readonly type: "locatedTimestamp";
  readonly required?: boolean;
  readonly sensitive?: boolean;
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
  | TimestampFieldDef
  | TzFieldDef
  | LocatedTimestampFieldDef
  | FileFieldDef
  | ImageFieldDef
  | FilesFieldDef
  | ImagesFieldDef;

// Union of all field variants that represent uploaded files. They share
// `maxSize` and `accept`, which is what upload validation cares about.
export type AnyFileFieldDef = FileFieldDef | ImageFieldDef | FilesFieldDef | ImagesFieldDef;

export function isFileField(field: FieldDefinition | undefined): field is AnyFileFieldDef {
  if (!field) return false;
  return (
    field.type === "file" ||
    field.type === "image" ||
    field.type === "files" ||
    field.type === "images"
  );
}

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
