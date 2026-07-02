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

// --- PII / Subject-Key Annotations (DSGVO Art. 17 — Crypto-Shredding) ---
//
// Felder die PII enthalten werden in Sprint 3 (crypto-shredding) mit einem
// Subject-Schluessel encrypted gespeichert. Subject = die natuerliche Person
// oder der Tenant der die Daten "besitzt". Loeschung erfolgt durch Vernichten
// des Subject-Keys ("Crypto-Shredding") — der Datensatz bleibt physisch
// (Audit-Trail bewahrt), ist aber nicht mehr entschluesselbar. Sprint 0
// fuegt nur die Schema-Marker + Boot-Validation ein; Encrypt/Decrypt-Mechanik
// kommt in Sprint 3.
//
// Drei orthogonale Markierungen:
//   - `pii: true`              — Subject = die Entity selbst.
//                                Beispiel: user.email gehoert User Marc.
//   - `userOwned: { ownerField }` — Subject = der User der im genannten
//                                Field referenziert ist.
//                                Beispiel: comment.body gehoert
//                                comment.authorId.
//   - `tenantOwned: true`      — Subject = der aktuelle Tenant
//                                (ctx.tenantId zur Schreibzeit).
//                                Beispiel: tenantBranding.brandColor.
//
// `anonymize` ist die Pro-Feld-Funktion die der retention-Cleanup-Job
// (Sprint 2) aufruft wenn die Entity-Strategy "anonymize" lautet oder die
// `blockDelete`-Frist abgelaufen ist. Beispiel: `() => "[ANONYMIZED]"` oder
// `() => null`.
//
// `allowPlaintext` unterdrueckt PII-Heuristik-Boot-Warnings fuer Felder die
// zwar PII-Naming haben (email, name, body) aber bewusst Klartext bleiben
// sollen — z.B. ticket.title als Geschaeftsdaten. Wert ist eine Begruendung
// wie "is-business-data".
//
// `anonymize` darf sync oder async sein — der Cleanup-Job (Sprint 2)
// awaited den Return. Async-Funktionen sind sinnvoll wenn die Anonymisierung
// einen Lookup braucht (z.B. konsistente Pseudonyme aus separater Tabelle).
//
// Siehe docs/plans/datenschutz/crypto-shredding.md und docs/plans/datenschutz/roadmap.md.
export type PiiAnnotations = {
  readonly pii?: boolean;
  readonly userOwned?: { readonly ownerField: string };
  readonly tenantOwned?: boolean;
  readonly anonymize?: () => unknown | Promise<unknown>;
  readonly allowPlaintext?: string;
};

// --- Retention (DSGVO Art. 5(1)(e) + HGB/AO Aufbewahrungspflichten) ---
//
// Pro Entity definiert der Author eine Default-Retention-Policy. Tenant-
// Admin uebersteuert sie via Compliance-Profile + Tenant-Override (Sprint 2).
// Vier Strategien:
//
//   - "hardDelete"  — Row physisch weg nach `keepFor`. Logs, Sessions.
//   - "softDelete"  — `deletedAt = now()`. Erlaubt spaetere Restore.
//   - "anonymize"   — Felder mit `anonymize`-Funktion ueberschrieben,
//                     Row bleibt. Order/Invoice mit gemischter PII +
//                     Geschaeftsdaten.
//   - "blockDelete" — Cleanup-Job ignoriert; User-Forget loest stattdessen
//                     `anonymize` aus. Buchhaltung, Mandate, Patientenakten.
//
// `keepFor` ist eine Duration-String wie "30d", "10y", "6m". Parser
// kommt im Cleanup-Job (Sprint 2). `reference` ist das Field das den
// Lebenszeit-Anker liefert (Default: `createdAt`). Sessions z.B. nutzen
// `lastSeenAt` damit aktive Sessions nicht weggemueht werden.
//
// Siehe docs/plans/features/core-data-retention.md und Sprint 2 in roadmap.md.
export type RetentionDef = {
  readonly keepFor: string;
  readonly strategy: "hardDelete" | "softDelete" | "anonymize" | "blockDelete";
  readonly reference?: string;
};

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
} & PiiAnnotations;

/**
 * Long-form text content — source-code, markdown, blog-posts, email-
 * templates, anything that can be megabytes large. Bewusst MINIMALE
 * Surface gegen `text`:
 *
 *   - **Kein `sortable`**: ORDER BY auf 100 KB-Strings kostet I/O ohne
 *     sinnvolles UX-Outcome (lex-Sortierung von Code ist Nonsense).
 *   - **Kein `searchable`**: ILIKE/Substring-Suche auf langen Texten
 *     skaliert nicht. Wer wirklich Volltextsuche will, nimmt den
 *     SearchAdapter (Meilisearch) — der hat eine eigene Pipeline mit
 *     Tokenizer + Index, NICHT diesen field-flag.
 *   - **Kein `filterable`**: WHERE auf langen Strings same Story wie
 *     sortable.
 *   - **Kein `format`**: email/url/phone sind kurz definierte Inputs,
 *     longText ist per Definition unstrukturiert.
 *
 * Type-level enforcement statt convention: wer sortable/searchable
 * braucht, nimmt `text` (mit den entsprechenden Skalierungs-Trade-offs).
 * DB-mapping ist identisch zu text (Postgres `text` ist unbounded).
 */
export type LongTextFieldDef = {
  readonly type: "longText";
  /** Optionale soft-Cap. Default unbounded (= Postgres-text-limit, 1 GB).
   *  Nützlich für defensive Caps wie 1 MB damit ein verirrter Browser-
   *  Paste nicht die DB sprengt. */
  readonly maxLength?: number;
  readonly required?: boolean;
  readonly encrypted?: boolean;
  readonly sensitive?: boolean;
  readonly default?: string;
  readonly access?: FieldAccess;
  readonly multiline?: boolean | { readonly rows?: number };
} & PiiAnnotations;

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
} & PiiAnnotations;

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
} & PiiAnnotations;

export type NumberFieldDef = {
  readonly type: "number";
  readonly required?: boolean;
  readonly sortable?: boolean;
  readonly filterable?: boolean;
  readonly sensitive?: boolean;
  readonly default?: number;
  readonly access?: FieldAccess;
  // Write-boundary constraints (Zod-level, no migration/storage impact — the
  // Postgres column stays a plain numeric). Opt-in, so existing entities are
  // unaffected.
  readonly min?: number;
  readonly integer?: boolean;
} & PiiAnnotations;

/**
 * 64-bit-Integer-Spalte fuer Audit-Counter, Byte-Sizes, Event-IDs und
 * andere Werte die >2^31 (~2.1 Mrd) wandern koennen. Storage als
 * Postgres `bigint`, JS-Round-trip als `number` (mode:"number" — sicher
 * bis 2^53 ≈ 9 PB, JSON-serialisierbar). Wer >2^53 braucht (rare),
 * nutzt einen `text`-Field mit eigenem Codec.
 *
 * Vorrang vor `NumberFieldDef`-(integer 32-bit-Cap, ~2.1 GB) immer dann
 * wenn der Wert physisch ueber dieses Limit klettern kann: Bytes,
 * Events, Counters in High-Throughput-Apps, Cumulative-Sums. Money
 * hat dafuer den eigenen `MoneyFieldDef` (mit Currency-Spalte).
 */
export type BigIntFieldDef = {
  readonly type: "bigInt";
  readonly required?: boolean;
  readonly sortable?: boolean;
  readonly filterable?: boolean;
  readonly sensitive?: boolean;
  readonly default?: number;
  readonly access?: FieldAccess;
} & PiiAnnotations;

/**
 * Exact decimal — Postgres `numeric(precision, scale)`. For values that need
 * fractional precision the integer `number` field (32-bit int) and `money`
 * field (BIGINT minor units + currency) can't hold: interest rates,
 * percentages, ratios, measurements.
 *
 * `precision` = total significant digits, `scale` = digits after the decimal
 * point (both required — no silent default that could truncate). pg returns
 * `numeric` as a string to preserve precision; the read-codec surfaces it as
 * a JS `number` (safe ≤ 2^53, same trade-off as `bigInt` mode:"number" — a
 * value past that boundary loses precision, so keep `precision - scale` ≤ 15).
 */
export type DecimalFieldDef = {
  readonly type: "decimal";
  readonly precision: number;
  readonly scale: number;
  readonly required?: boolean;
  readonly sortable?: boolean;
  readonly filterable?: boolean;
  readonly sensitive?: boolean;
  readonly default?: number;
  readonly access?: FieldAccess;
} & PiiAnnotations;

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
// `entity` akzeptiert zwei Formen:
//   - kurz ("customer") — same-feature reference, Default-Pfad.
//   - qualifiziert ("users:user") — cross-feature, Format
//     "<featureName>:<entityName>". Renderer baut die Lookup-Query-QN
//     gegen das angegebene Feature (`users:query:user:list`).
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
  /** Multi-Reference (Tier 2.7e-Multi): Wert ist ein Array von UUIDs
   *  statt single UUID. Storage als jsonb-Array<uuid>. UI rendert
   *  Multi-Select-Combobox mit Tag-Anzeige der gewählten Items. */
  readonly multiple?: boolean;
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
} & PiiAnnotations;

// Free-form jsonb — keys/shape NOT validated at write-time. Use for:
//   - Tenant-defined extension data (custom-fields-bundle uses this for
//     `customFields` on host-entities — keys are dynamic per fieldDefinition)
//   - Configuration-blobs with shape that evolves outside Stammfeld-schema
//   - AI-inferred metadata where shape is provider-dependent
//
// Vs. embedded: embedded enforces a typed sub-schema; jsonb accepts any
// JSON-shaped object. Read-side both map to Postgres `jsonb`. Default `{}`
// + NOT NULL, identisch zu embedded.
export type JsonbFieldDef = {
  readonly type: "jsonb";
  readonly sensitive?: boolean;
  readonly access?: FieldAccess;
} & PiiAnnotations;

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
  /** Erlaubte Datumsgrenzen als ISO `yyyy-mm-dd` (z.B. Geburtsdatum nicht
   *  in der Zukunft: `max` = heute). Begrenzt den Picker und wird vom
   *  Zod-Schema beim Write durchgesetzt. */
  readonly min?: string;
  readonly max?: string;
  /** Format/Locale-Override für Anzeige und Eingabe-Parsing (z.B.
   *  "de-DE"). Default = App-Locale. */
  readonly locale?: string;
} & PiiAnnotations;

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
  /** Erlaubte Grenzen als ISO-Datetime. Begrenzt den Picker auf
   *  Tages-Granularität; die exakte Uhrzeit-Grenze setzt das Zod-Schema
   *  beim Write durch. */
  readonly min?: string;
  readonly max?: string;
  /** Format/Locale-Override für Anzeige und Eingabe-Parsing. Default =
   *  App-Locale. */
  readonly locale?: string;
} & PiiAnnotations;

// IANA-Zonenname (z.B. "Europe/Berlin", "America/Los_Angeles").
// Wird via `Intl.supportedValuesOf("timeZone")` validiert (kommt im
// Zod-Validator-Schritt). Eigener Field-Typ damit Type-Safety + Storage
// (TEXT-Spalte) korrekt sind und der `locatedBy`-Marker eindeutig auflöst.
export type TzFieldDef = {
  readonly type: "tz";
  readonly required?: boolean;
  readonly sensitive?: boolean;
  readonly access?: FieldAccess;
} & PiiAnnotations;

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
  /** Erlaubte Grenzen als ISO-Datetime (Wall-Clock). Begrenzt den Picker
   *  auf Tages-Granularität; die exakte Uhrzeit-Grenze setzt das Zod-Schema
   *  beim Write durch. */
  readonly min?: string;
  readonly max?: string;
  /** Format/Locale-Override für Anzeige und Eingabe-Parsing. Default =
   *  App-Locale. */
  readonly locale?: string;
} & PiiAnnotations;

export type FileFieldDef = {
  readonly type: "file";
  readonly required?: boolean;
  readonly maxSize?: string;
  readonly accept?: readonly string[];
  readonly access?: FieldAccess;
};

export type ImageFieldDef = {
  readonly type: "image";
  readonly required?: boolean;
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
  | LongTextFieldDef
  | BooleanFieldDef
  | SelectFieldDef
  | MultiSelectFieldDef
  | NumberFieldDef
  | BigIntFieldDef
  | DecimalFieldDef
  | MoneyFieldDef
  | ReferenceFieldDef
  | EmbeddedFieldDef
  | JsonbFieldDef
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

// --- Derived (computed) fields ---
//
// A derived field is read-time only: its value is computed from the stored row
// (and the clock) when an entityList query runs (676/2 — NOT detail; only the
// "list" case in entity-handlers.ts calls augmentDerivedFields), never
// persisted. It lives in
// `EntityDefinition.derivedFields` — deliberately NOT in `fields`, so it
// produces no DB column, never enters a write schema, and can't be the target
// of an entityEdit. A declarative `entityList` can name it like any column and
// the view-model renders the appended value.
//
// LIMIT: derived columns are DISPLAY ONLY. A declarative `entityList` loads its
// rows server-side and a column-header sort round-trips to the server, where
// `executor.list` sorts/filters/searches over real SQL columns — so a derived
// field (no column) silently no-ops. There is no client-side sort path. Need a
// derived value sortable/searchable? Materialize it as a stored field; it then
// rides the existing `searchable`/`sortable` machinery. Time-dependent values
// (as-of-today) can't be materialized without a daily re-index anyway.

/** Display type a derived value formats as — drives the column's renderer
 *  choice in the view-model, parallel to FieldDefinition["type"]. Single-column
 *  types only: `money` is excluded because it needs a `<name>Currency`
 *  companion column a derived field has no place to put — use `number`/
 *  `decimal` plus a `{ format: "currency" }` column renderer instead. */
export type DerivedValueType = "text" | "number" | "decimal" | "boolean" | "date" | "timestamp";

/** Clock injected into `derive` — never read `Temporal.Now`/`Date` inside a
 *  derive body (no-date-api guard + testability). The list-query handler passes
 *  the read-time instant; unit tests pass a fixed one. */
export type DeriveContext = {
  readonly asOf: Temporal.Instant;
};

export type DerivedFieldDef = {
  readonly valueType: DerivedValueType;
  /** Pure function of the stored row + clock. Returns the JSON-safe display
   *  value (e.g. integer minor units for a currency column, ISO string for a
   *  `date`). */
  readonly derive: (row: Readonly<Record<string, unknown>>, ctx: DeriveContext) => unknown;
};

export type DerivedFieldsMap = Readonly<Record<string, DerivedFieldDef>>;

/** Client-facing projection of DerivedFieldDef — `derive` is server-only and
 *  not JSON-safe (would trip the output-walk guard), so the browser schema
 *  only ever carries `valueType`. A real `Pick`, not a same-shape cast: TS
 *  itself proves `derive` isn't there instead of a `{ valueType } as
 *  DerivedFieldDef` cast lying about a field that's actually missing. */
export type ClientDerivedFieldDef = Pick<DerivedFieldDef, "valueType">;

// --- Entity ---

// --- State Transitions ---

export type TransitionMap = Readonly<Record<string, readonly string[]>>;

/** Composite-Index auf einer Entity. Spalten werden via field-Name
 *  referenziert (camelCase). buildEntityTable mapped sie auf snake_case-
 *  Spaltennamen und benennt den Index nach Convention:
 *
 *    <table>_<col1>_<col2>_idx          (non-unique)
 *    <table>_<col1>_<col2>_unique       (unique)
 *
 *  Eine `name`-Override ist erlaubt — Convention-Bruch in Bestandscode
 *  vermeidet Migration-Churn beim Refactor.
 *
 *  Single-column indices über `tenantId` sind redundant (buildEntityTable
 *  legt die immer automatisch an); die Boot-Validation warnt (außer
 *  `{ unique: true }` — semantische 1:1-Constraint, kein Performance-Hint). */
export type EntityIndexDef = {
  readonly columns: readonly [string, ...string[]];
  readonly unique?: boolean;
  readonly name?: string;
  /**
   * Optional SQL-Fragment fuer Partial-Index — `CREATE [UNIQUE] INDEX
   * ... WHERE <condition>`. Postgres-Pattern fuer "Index nur unter
   * bestimmten Bedingungen", typisches Beispiel: ExportJob-Idempotency
   * `UNIQUE(userId) WHERE status IN ('pending', 'running')`.
   *
   * Caller baut das Fragment via drizzle-orm `sql\`...\``-Tagged-
   * Template. table-builder.ts emittiert `.where(def.where)` auf den
   * Drizzle-IndexBuilder — wirkt sowohl fuer unique- als auch fuer
   * non-unique-Indexes (PG erlaubt beides; non-unique partial nutzt
   * man z.B. fuer scharfe BTREE-Indexes nur auf einer Status-Teilmenge
   * statt voller Tabelle).
   */
  readonly where?: unknown;
};

export type FieldsMap = Readonly<Record<string, FieldDefinition>>;

export type EntityDefinition<F extends FieldsMap = FieldsMap> = {
  readonly table?: string;
  readonly fields: F;
  readonly softDelete?: boolean;
  /** This aggregate's event stream lives on SYSTEM_TENANT_ID rather than the
   *  creator's tenant. Opt-in per entity (NOT inherited from r.systemScope()):
   *  only for genuinely tenant-independent aggregates like `user`. The first
   *  event (create) is what's routed; updates resolve the stream tenant upstream. */
  readonly systemStream?: boolean;
  readonly searchWeight?: number;
  readonly defaultCurrency?: string;
  /** Allowed state transitions per field. Boot validates against select options. */
  readonly transitions?: Readonly<Record<string, TransitionMap>>;
  /** Composite-Indices über mehrere Felder. Single-column FK-Indices und
   *  der tenant_id-Index werden weiterhin automatisch von buildEntityTable
   *  angelegt — diese Liste ist nur für Custom-Indices die der Author
   *  explizit deklariert (z.B. `{ unique: true, columns: ["key", "tenantId", "userId"] }`). */
  readonly indexes?: readonly EntityIndexDef[];
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
  /**
   * Default-Retention-Policy fuer diese Entity. Tenant-Admin kann via
   * Compliance-Profile + Tenant-Override (Sprint 2) uebersteuern.
   * Cleanup-Job (Sprint 2) verarbeitet die Strategy:
   *
   *   - "hardDelete" → Row physisch weg nach keepFor
   *   - "softDelete" → deletedAt = now() (mit core-soft-delete-Feature)
   *   - "anonymize"  → Felder mit `anonymize`-Funktion ueberschrieben,
   *                    Row bleibt
   *   - "blockDelete" → Cleanup-Job ignoriert; User-Forget loest
   *                     stattdessen anonymize aus. Buchhaltung, Mandate,
   *                     Patientenakten.
   *
   * Siehe docs/plans/features/core-data-retention.md.
   */
  readonly retention?: RetentionDef;
  /**
   * Read-time computed fields, keyed by name. Not stored, not a DB column,
   * not writable — appended to each row by the list/detail query handler and
   * nameable as a column in a declarative `entityList`. See DerivedFieldDef.
   */
  readonly derivedFields?: DerivedFieldsMap;
};
