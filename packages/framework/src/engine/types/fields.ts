// --- Field Types ---

// OwnershipMap is declared in engine/ownership.ts — field-access maps to
// per-role ownership rules. A legacy `readonly string[]` form is still
// accepted at the type layer during migration: features that pass an
// array are auto-normalized to { [role]: "all" } at registry build.
// Long-term: string[] disappears.
import type { OwnershipMap } from "../ownership";

export type FieldAccess = {
  readonly read?: OwnershipMap | readonly string[];
  readonly write?: OwnershipMap | readonly string[];
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
  /** Author erlaubt Screen-Filter auf diesem Feld (Tier 2.7c).
   *  Boot-Validator weist Filter mit `filterable !== true` zurück.
   *  Default: false — analog zu `sortable`, opt-in. */
  readonly filterable?: boolean;
  readonly encrypted?: boolean;
  readonly sensitive?: boolean;
  readonly format?: "email" | "url" | "phone";
  readonly default?: string;
  readonly access?: FieldAccess;
  /** Mehrzeiliger Text — DefaultInput rendert dann ein <textarea> statt
   *  <input type="text">. `true` = Default 4 Zeilen, `{ rows: N }` =
   *  explizite Höhe. Search/sort/encrypt verhalten sich unverändert
   *  identisch zu single-line — nur die Render-Surface wechselt. */
  readonly multiline?: boolean | { readonly rows?: number };
};

export type BooleanFieldDef = {
  readonly type: "boolean";
  readonly required?: boolean;
  readonly sortable?: boolean;
  readonly filterable?: boolean;
  readonly sensitive?: boolean;
  readonly default?: boolean;
  readonly access?: FieldAccess;
};

export type SelectFieldDef<TOptions extends readonly string[] = readonly string[]> = {
  readonly type: "select";
  readonly options: TOptions;
  readonly required?: boolean;
  readonly sortable?: boolean;
  readonly filterable?: boolean;
  readonly sensitive?: boolean;
  readonly default?: TOptions[number];
  readonly access?: FieldAccess;
};

// Mehrere Werte aus einer festen Options-Liste — UI rendert als
// Checkbox-/Multi-Select-Kontrolle. Storage: jsonb-Array<string>;
// jeder Eintrag muss in `options` enthalten sein.
//
// Wann statt `select`: wenn der User mehr als einen Wert gleichzeitig
// auswählen darf (Führerscheinklassen, Tags, Sprachen, Skills).
// Wann statt `embedded` mit Booleans: wenn die Option-Liste nicht
// hardcoded sein soll oder bei mehr als ~5 Optionen — sonst explodiert
// das embedded-Schema.
//
// Ordering: das Array bewahrt die Caller-Reihenfolge (jsonb-array, nicht
// set). Das Framework dedupliziert beim Schreiben nicht — Validator
// rejected Duplikate erst wenn Bedarf da ist.
export type MultiSelectFieldDef<TOptions extends readonly string[] = readonly string[]> = {
  readonly type: "multiSelect";
  readonly options: TOptions;
  readonly required?: boolean;
  readonly filterable?: boolean;
  readonly sensitive?: boolean;
  /** Default-Auswahl. Jeder Eintrag muss in `options` sein (Boot-Validator). */
  readonly default?: readonly TOptions[number][];
  readonly access?: FieldAccess;
};

export type NumberFieldDef = {
  readonly type: "number";
  readonly required?: boolean;
  readonly sortable?: boolean;
  readonly filterable?: boolean;
  readonly sensitive?: boolean;
  readonly default?: number;
  readonly access?: FieldAccess;
};

export type MoneyFieldDef = {
  readonly type: "money";
  readonly required?: boolean;
  readonly sortable?: boolean;
  readonly filterable?: boolean;
  readonly sensitive?: boolean;
  readonly access?: FieldAccess;
};

// Reference-Field (Tier 2.7e-3) — FK-Style Verweis auf eine andere
// Entity. Gespeichert als UUID-Spalte (uuid type), Read-Side liefert
// optional die referenced Row mit (Tier 2.7e-4 eagerload).
//
// Single-Reference (multiple: false / undefined): ein UUID. Multi-
// Reference ist BEWUSST nicht in diesem MVP — JSONB-Array-Storage
// + Multi-Lookup-UI verlangen Searchable-Select (Tier 2.1c) das es
// noch nicht gibt. Folgt in Tier 2.7e-5 / 2.7f.
//
// `entity` ist der kurze Entity-Name (z.B. "customer", "user") im
// SELBEN Feature wie das referencing Field. Cross-Feature-Refs sind
// im MVP nicht supported — der Boot-Validator prüft Lokalität.
//
// `labelField` (optional) — welches Feld der referenced Entity wird
// im Select-Dropdown als Label gezeigt. Default: "id". Best practice
// ist ein menschlich-lesbares Feld wie "name", "title", "email".
export type ReferenceFieldDef = {
  readonly type: "reference";
  readonly entity: string;
  readonly required?: boolean;
  readonly filterable?: boolean;
  readonly sensitive?: boolean;
  readonly access?: FieldAccess;
  /** Welches Feld der referenced Entity als Display-Label im
   *  Select-Dropdown erscheint. Default: "id". Boot-Validator pinst
   *  dass das Feld auf der referenced Entity existiert. */
  readonly labelField?: string;
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
  readonly sortable?: boolean;
  readonly filterable?: boolean;
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
  readonly sortable?: boolean;
  readonly filterable?: boolean;
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
  readonly sortable?: boolean;
  readonly filterable?: boolean;
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
  | MultiSelectFieldDef
  | NumberFieldDef
  | MoneyFieldDef
  | ReferenceFieldDef
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
  /**
   * Row-level ownership rules (H.2). read runs as WHERE-predicate on list/
   * detail/queryProjection, scoping which rows the caller sees. write runs
   * pre-save on create/update/delete, scoping which rows the caller may
   * modify (Straddle-safe, multi-role atomic — see engine/ownership.ts).
   *
   * Keys are role names; rules use the `from()` helper or `{ where }`
   * escape hatch. Entity-level ownership is AND-ed with tenant isolation —
   * a user's tenant filter still applies first.
   */
  readonly access?: {
    readonly read?: OwnershipMap;
    readonly write?: OwnershipMap;
  };
};
