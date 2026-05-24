import type {
  EntityDefinition,
  EntityRelations,
  FieldDefinition,
  FieldsMap,
} from "../engine/types";
import { assertUnreachable } from "../utils";
import {
  bigint,
  boolean,
  type ColumnBuilder,
  type ColumnHandle,
  type IndexBuilderWithCols,
  index,
  instant,
  integer,
  jsonb,
  moneyAmount,
  table as pgTable,
  type SqlExpression,
  serial,
  sql,
  type TableColumns,
  text,
  uniqueIndex,
  uuid,
} from "./dialect";

// Local AnyPgColumn alias — kept for legacy field-definition callers that
// still import this name as a type. ColumnHandle from the native dialect
// matches the same role (snake_case name + sql type accessor).
export type AnyPgColumn = ColumnHandle;

// biome-ignore lint/suspicious/noExplicitAny: ColumnBuilder is parameterised over value type; we erase here
type AnyColumnBuilder = ColumnBuilder<any>;

// Returns column(s) for a field. Most fields return a single entry,
// money returns two (amount + currency), files/images return none.
//
// `required: true` auf einem FieldDefinition mappt **immer** auf .notNull()
// in der DB-Spalte. Die alte Implementation hat das nur für reference-
// fields gemacht — text/select/number/etc. waren stillschweigend nullable
// in der DB, auch wenn der API-Validator required erzwungen hat. Folge:
// hand-written PgTable-Definitionen mussten daneben mit .notNull() pflegen,
// was zu Doppel-Definitionen + Schema-Drift führte. Jetzt ist r.entity
// die einzige Wahrheit.
function fieldToColumns(
  name: string,
  field: FieldDefinition,
  entity: EntityDefinition,
): Record<string, AnyColumnBuilder> {
  const snakeName = toSnakeCase(name);

  switch (field.type) {
    case "text":
    case "longText": {
      // Beide mappen auf PG `text` (unbounded). Unterschied lebt nur
      // im Type-Layer: longText hat kein sortable/searchable/filterable
      // (Sprint 5b vorab). Reihenfolge default() VOR notNull(): drizzle's
      // column-builder chained beides; ohne default() hat die generierte
      // SQL keinen DEFAULT-clause (bricht ALTER TABLE ADD COLUMN auf
      // existing rows). longText hat heute kein default-feld im type,
      // aber der check `field.default !== undefined` ist defensive.
      const base = text(snakeName);
      const withDefault =
        "default" in field && field.default !== undefined ? base.default(field.default) : base;
      return { [name]: field.required ? withDefault.notNull() : withDefault };
    }
    case "boolean":
      return {
        [name]:
          field.default !== undefined
            ? boolean(snakeName).default(field.default).notNull()
            : field.required
              ? boolean(snakeName).notNull()
              : boolean(snakeName),
      };
    case "select": {
      const col = text(snakeName);
      return { [name]: field.required ? col.notNull() : col };
    }
    case "multiSelect":
      // jsonb-Array<string> mit Default `[]` und immer NOT NULL.
      //
      // Der `required`-Flag auf MultiSelectFieldDef wird hier bewusst
      // ignoriert: Mit Default `[]` ist das Feld strukturell never-null
      // (Insert ohne Wert → leeres Array, nicht NULL). Read-Side-Code
      // braucht keinen null-check, das ist API-Garantie. Wer "wirklich
      // null" will (= "Feld noch nie gesetzt") nutzt einen separaten
      // Status-Field oder ein optional-typed reference statt eines
      // multi-select.
      return { [name]: jsonb(snakeName).default([]).notNull() };
    case "number": {
      const col = integer(snakeName);
      return { [name]: field.required ? col.notNull() : col };
    }
    case "bigInt": {
      // 64-bit-Integer fuer Audit-Counter, Byte-Sizes, Cumulative-Sums.
      // mode:"number" liefert JS-`number` (sicher bis 2^53 ≈ 9 PB) statt
      // JS-`bigint` — JSON-serialisierbar, Frontend-tauglich. Wer >2^53
      // braucht (Astronomie-Astronomie), nutzt einen Text-Field mit
      // eigenem Codec.
      const col = bigint(snakeName, { mode: "number" });
      return { [name]: field.required ? col.notNull() : col };
    }
    case "reference":
      // Tier 2.7e-3: FK-Style UUID-Spalte. Multi-Mode (Tier 2.7e-Multi)
      // speichert UUIDs als jsonb-Array<string>. Single-Mode bleibt
      // klassische UUID-Spalte (NOT NULL nur bei required).
      if (field.multiple === true) {
        return { [name]: jsonb(snakeName).default([]).notNull() };
      }
      return {
        [name]: field.required ? uuid(snakeName).notNull() : uuid(snakeName),
      };
    case "money":
      // BIGINT storing the integer minor unit (cents for EUR, yen for JPY —
      // the currency column tells you which). INTEGER would cap at ~21 M EUR
      // which is too tight for B2B invoices, property values or balance
      // aggregates. BIGINT handles up to ~90 trillion EUR safely in JS.
      // Currency hat immer einen Default, ist also strukturell .notNull().
      return {
        [name]: field.required ? moneyAmount(snakeName).notNull() : moneyAmount(snakeName),
        [`${name}Currency`]: text(`${snakeName}_currency`)
          .default(entity.defaultCurrency ?? "EUR")
          .notNull(),
      };
    case "embedded":
      // jsonb mit default `{}` und immer NOT NULL — analog zu multiSelect.
      // `required` wird bewusst ignoriert weil der Default das Feld
      // strukturell never-null macht. Wer optional-embedded möchte (=
      // "Feld komplett weglassen können") modelliert das über ein
      // wrapper-feld mit boolean-flag oder discriminierte-union.
      return { [name]: jsonb(snakeName).default({}).notNull() };
    case "jsonb":
      // Free-form jsonb — keys nicht schema-validated. Default `{}`, NOT NULL
      // (analog zu embedded). Use-case: custom-fields-Bundle's host-entity-
      // `customFields`-Spalte (tenant-definierte dynamische keys).
      return { [name]: jsonb(snakeName).default({}).notNull() };
    case "date": {
      // `type:"date"` aliased auf instant() = TIMESTAMPTZ. Echte
      // PlainDate-Migration (PG `date` Spalte, kein TZ) kommt später.
      const col = instant(snakeName);
      return { [name]: field.required ? col.notNull() : col };
    }
    case "timestamp": {
      // UTC-Instant — gespeichert als TIMESTAMPTZ in PG, gelesen/geschrieben
      // als Temporal.Instant via instant() customType (siehe dialect.ts).
      // Sprint F: Single-Mode-Welt — Caller-Code kennt nur Temporal.Instant,
      // nie JS-Date. Auch Vergleiche (lte/gt/orderBy) akzeptieren Instants
      // direkt, kein .toString()-Cast nötig.
      const col = instant(snakeName);
      return { [name]: field.required ? col.notNull() : col };
    }
    case "tz": {
      // IANA-Zonenname als TEXT — Validierung über Zod-Schema (kommt im
      // Validator-Schritt). Snake-Convention: `pickup_tz`.
      const col = text(snakeName);
      return { [name]: field.required ? col.notNull() : col };
    }
    case "locatedTimestamp": {
      // ZWEI Spalten als atomares Pair: <name>_utc TIMESTAMPTZ + <name>_tz TEXT.
      // _utc ist instant() (Temporal.Instant), _tz ist text (IANA-Name).
      // Auto-Convert (at+tz → utc beim Insert; utc+tz → at beim Read) wird
      // im Executor verdrahtet (Phase C). required propagiert auf beide.
      const utc = instant(`${snakeName}_utc`);
      const tz = text(`${snakeName}_tz`);
      return {
        [`${name}Utc`]: field.required ? utc.notNull() : utc,
        [`${name}Tz`]: field.required ? tz.notNull() : tz,
      };
    }
    case "file":
    case "image": {
      // Single file: stores fileRefId as UUID — must match fileRefsTable.id
      // (uuid column). Anything narrower (integer, text length-limited) would
      // silently truncate or type-coerce at INSERT time and the FK reference
      // would be unusable.
      const col = uuid(snakeName);
      return { [name]: field.required ? col.notNull() : col };
    }
    case "files":
    case "images":
      // Multi file: no column in entity table, resolved via FileRef table
      // over (entityType, entityId, fieldName). A bridge-table with
      // CASCADE + sort-order is a later improvement; today plural files
      // live entirely in fileRefsTable.
      return {};
    default:
      assertUnreachable(field, "field type");
  }
}

// Accepts both camelCase (`tenantMembership`) and kebab-case (`tenant-membership`)
// entity / field names. Kebab is the canonical form for new multi-word entity
// types (consistent across r.entity, event-types, table names) — camelCase is
// kept working for already-shipped code.
export function toSnakeCase(str: string): string {
  return str.replace(/-/g, "_").replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Derives a table name from an entity name:
 * 1. camelCase → snake_case (e.g. "memberTask" → "member_task")
 * 2. Simple English pluralization (category→categories, status→statuses, task→tasks)
 * 3. `read_` prefix — markiert die Tabelle als Event-Sourced-Read-Model,
 *    damit im DB-Tool sofort erkennbar ist dass App-Code nicht direkt
 *    reinschreibt. Event-Store (kumiko_events) + Framework-State
 *    (kumiko_*) haben ihren eigenen Prefix, normale App-Side-Tables
 *    (ohne ES-Anbindung) haben keinen — die drei Kategorien sind damit
 *    im Tabellenbrowser unterscheidbar.
 */
const ES_PLURAL_SUFFIXES = ["s", "sh", "ch", "x"] as const;

export const READ_MODEL_PREFIX = "read_";

export function toTableName(entityName: string): string {
  const snake = toSnakeCase(entityName);
  let plural: string;
  if (snake.endsWith("y") && !/[aeiou]y$/.test(snake)) {
    plural = `${snake.slice(0, -1)}ies`;
  } else if (ES_PLURAL_SUFFIXES.some((suffix) => snake.endsWith(suffix))) {
    plural = `${snake}es`;
  } else {
    plural = `${snake}s`;
  }
  return `${READ_MODEL_PREFIX}${plural}`;
}

// Drizzle's PgTableWithColumns<any> erbt eine `[k: string]: any` Index-
// Signature die in strict-mode (noUncheckedIndexedAccess + TS4111) jeden
// konsumierenden Code zwingt auf Bracket-Notation auch für bekannte
// Spalten. Da wir die Tabelle dynamisch aus EntityDefinition bauen,
// kann TS Drizzle's volle Spalten-Inferenz nicht liefern — wir spiegeln
// stattdessen die `fieldToColumns`-Logik im Type-System: jeder Field-Type
// mappt auf einen konkreten data-Type, ColumnsForEntity baut daraus den
// vollständigen Property-Bag.
//
// Mit konkret-inferiertem `F` (via createEntity({ fields: { ... } }))
// kommt das volle data-typing durch Drizzle's `eq()`/`select()`/`row.x`
// am Call-Site an. Der alte `EntityDefinition` ohne Generic-Param fällt
// auf `FieldsMap` zurück (= breaking-change-frei) — dort kennt TS die
// Field-Types nicht, das Mapping kollabiert auf `AnyPgColumn`.
//
// Lock-step-Vertrag: jeder Branch hier muss zur Runtime-Entscheidung in
// fieldToColumns passen. Type-Tests gegen repräsentative Entities (siehe
// db/__tests__/drizzle-table-types.test.ts) catchen Drift.

// Single column handle with concrete data + nullability phantom. After the
// drizzle removal the runtime carries only the snake_case name + pg type
// (see ColumnHandle); the phantom-typed wrapper preserves the existing
// generic-inference call-sites without recreating drizzle's full column
// brand graph.
type Col<_T> = ColumnHandle & { readonly __notNull: true };
type NullCol<_T> = ColumnHandle & { readonly __notNull: false };

// Per-field column shape — matches `fieldToColumns`. Money +
// locatedTimestamp produce two-column pairs; files/images contribute no
// columns (resolved via FileRef table). `notNull` propagiert von
// `field.required` (literal preserved by createXField generics).
type ColumnsForField<K extends string, F extends FieldDefinition> = F extends {
  type: "text" | "select" | "tz";
}
  ? F extends { required: true }
    ? { readonly [P in K]: Col<string> }
    : { readonly [P in K]: NullCol<string> }
  : F extends { type: "boolean" }
    ? // boolean default OR required → notNull (DB has DEFAULT, structurally never-null)
      F extends { default: boolean } | { required: true }
      ? { readonly [P in K]: Col<boolean> }
      : { readonly [P in K]: NullCol<boolean> }
    : F extends { type: "multiSelect" }
      ? // jsonb default `[]`, immer notNull
        { readonly [P in K]: Col<readonly string[]> }
      : F extends { type: "number" }
        ? F extends { required: true }
          ? { readonly [P in K]: Col<number> }
          : { readonly [P in K]: NullCol<number> }
        : F extends { type: "money" }
          ? F extends { required: true }
            ? { readonly [P in K]: Col<number> } & {
                readonly [P in `${K}Currency`]: Col<string>;
              }
            : { readonly [P in K]: NullCol<number> } & {
                readonly [P in `${K}Currency`]: Col<string>;
              }
          : F extends { type: "reference"; multiple: true }
            ? { readonly [P in K]: Col<readonly string[]> }
            : F extends { type: "reference" }
              ? F extends { required: true }
                ? { readonly [P in K]: Col<string> }
                : { readonly [P in K]: NullCol<string> }
              : F extends { type: "embedded" }
                ? // jsonb default `{}`, immer notNull
                  { readonly [P in K]: Col<Readonly<Record<string, unknown>>> }
                : F extends { type: "date" | "timestamp" }
                  ? F extends { required: true }
                    ? { readonly [P in K]: Col<Temporal.Instant> }
                    : { readonly [P in K]: NullCol<Temporal.Instant> }
                  : F extends { type: "locatedTimestamp" }
                    ? F extends { required: true }
                      ? { readonly [P in `${K}Utc`]: Col<Temporal.Instant> } & {
                          readonly [P in `${K}Tz`]: Col<string>;
                        }
                      : { readonly [P in `${K}Utc`]: NullCol<Temporal.Instant> } & {
                          readonly [P in `${K}Tz`]: NullCol<string>;
                        }
                    : F extends { type: "file" | "image" }
                      ? F extends { required: true }
                        ? { readonly [P in K]: Col<string> }
                        : { readonly [P in K]: NullCol<string> }
                      : F extends { type: "files" | "images" }
                        ? Record<never, never>
                        : never;

type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (
  k: infer I,
) => void
  ? I
  : never;

type ColumnsForEntity<F extends FieldsMap> = UnionToIntersection<
  {
    [K in keyof F & string]: ColumnsForField<K, F[K]>;
  }[keyof F & string]
>;

// Base-Spalten von buildBaseColumns — `idType: "serial"` returnt number,
// sonst uuid-as-string. `insertedAt` hat `default(now())`, ist also
// strukturell non-null (Drizzle's `notNull` flag matcht das).
type BaseColumnsType<E extends EntityDefinition> = {
  readonly id: E extends { idType: "serial" } ? Col<number> : Col<string>;
  readonly tenantId: Col<string>;
  readonly version: Col<number>;
  readonly insertedAt: Col<Temporal.Instant>;
  readonly modifiedAt: NullCol<Temporal.Instant>;
  readonly insertedById: NullCol<string>;
  readonly modifiedById: NullCol<string>;
};

// SoftDelete-Spalten existieren nur wenn entity.softDelete === true. Das
// Type-Level kann das nicht klein narrowen ohne Generic auf softDelete,
// also unionen wir beide Sets — Lean-Entities sehen die never-präsenten
// Spalten als typed-existierend, was dem alten `<any>`-Verhalten matcht.
type SoftDeleteColumnsType = {
  readonly isDeleted: Col<boolean>;
  readonly deletedAt: NullCol<Temporal.Instant>;
  readonly deletedById: NullCol<string>;
};

export type EntityTable<E extends EntityDefinition = EntityDefinition> =
  TableColumns<// biome-ignore lint/suspicious/noExplicitAny: drizzle's internal table-config stays generic; we layer typed columns on top via the intersection below.
  any> &
    BaseColumnsType<E> &
    SoftDeleteColumnsType &
    ColumnsForEntity<E["fields"]>;

export function buildBaseColumns(softDelete: boolean, idType: "serial" | "uuid" = "uuid") {
  const idColumn =
    idType === "uuid"
      ? uuid("id").primaryKey().default(sql`gen_random_uuid()`)
      : serial("id").primaryKey();

  const base = {
    id: idColumn,
    tenantId: uuid("tenant_id").notNull(),
    version: integer("version").default(1).notNull(),
    // Sprint F: Temporal.Instant durchgängig (siehe instant() in dialect.ts).
    // Vorher mode default "date" → Inkonsistenz mit user-defined timestamp
    // Felder (mode "string"). Jetzt: ein Mode für alle Timestamps.
    // customType doesn't expose Drizzle's `defaultNow()` shortcut — use raw
    // SQL so PG sets the value on insert and we don't need to pass an
    // Instant from JS for every row create.
    insertedAt: instant("inserted_at").default(sql`now()`).notNull(),
    modifiedAt: instant("modified_at"),
    // User-IDs are stringified UUIDs post-ES migration. Text (not uuid) so the
    // columns accept system actors ("SYSTEM", "SEED", etc.) and legacy-shaped
    // integer ids during transitional tests.
    insertedById: text("inserted_by_id"),
    modifiedById: text("modified_by_id"),
  };

  if (softDelete) {
    return {
      ...base,
      isDeleted: boolean("is_deleted").default(false).notNull(),
      deletedAt: instant("deleted_at"),
      deletedById: text("deleted_by_id"),
    };
  }

  return base;
}

export type BuildEntityTableOptions = {
  readonly featureName?: string;
  // Relations declared for this entity. When present, every belongsTo
  // foreignKey gets an index — otherwise joins and `WHERE fk = ?` filters
  // sequential-scan the child table. Pass the output of
  // `registry.getRelations(entityName)` or the raw relations block.
  readonly relations?: EntityRelations;
};

export function buildEntityTable<E extends EntityDefinition>(
  entityName: string,
  entity: E,
  options?: BuildEntityTableOptions,
): EntityTable<E> {
  const baseColumns = buildBaseColumns(entity.softDelete ?? false, entity.idType ?? "uuid");
  const fieldColumns: Record<string, AnyColumnBuilder> = {};

  for (const [name, field] of Object.entries(entity.fields)) {
    const cols = fieldToColumns(name, field, entity);
    Object.assign(fieldColumns, cols);
  }

  // Default table name derived from entityName (e.g. "memberTask" → "read_member_tasks")
  const baseTableName = entity.table ?? toTableName(entityName);
  // featureName-prefix wird zwischen read_ und den base-Namen geschoben,
  // damit alle read-models einheitlich mit `read_` starten — egal ob
  // featureName gesetzt ist oder nicht. Beispiel:
  //   featureName="shop", base="read_orders"  →  "read_shop_orders"
  //   featureName=undef,  base="read_orders"  →  "read_orders"
  //   featureName="shop", base="orders" (no read_)  →  "shop_orders"
  const tableName = options?.featureName
    ? baseTableName.startsWith(READ_MODEL_PREFIX)
      ? `${READ_MODEL_PREFIX}${options.featureName}_${baseTableName.slice(READ_MODEL_PREFIX.length)}`
      : `${options.featureName}_${baseTableName}`
    : baseTableName;

  // Build the list of foreign-key columns to index. Sources:
  //  (a) single-file / single-image fields store a fileRef id and are queried
  //      by that id whenever a detail view resolves attachments.
  //  (b) belongsTo relations declared via r.relation() — the FK column is the
  //      parent-side lookup key; without an index every child join scans the
  //      full table.
  // `Set` keeps the list deduplicated when (a) and (b) name the same column.
  const foreignKeyFields = new Set<string>();
  for (const [name, field] of Object.entries(entity.fields)) {
    if (field.type === "file" || field.type === "image") {
      foreignKeyFields.add(name);
    }
  }
  if (options?.relations) {
    for (const rel of Object.values(options.relations)) {
      if (rel.type === "belongsTo") foreignKeyFields.add(rel.foreignKey);
    }
  }

  // Cast back to EntityTable<E>: drizzle-kit's pgTable returns a fully
  // inferred PgTableWithColumns over the *exact* column-builder map we
  // hand in. Our typed signature narrows that to the static names from
  // EntityDefinition (kept in sync with fieldToColumns + buildBaseColumns).
  // Drizzle's runtime instance carries every needed method on top.
  return pgTable(
    tableName,
    {
      ...baseColumns,
      ...fieldColumns,
    },
    // Every multi-tenant query filters by tenant_id. Without this index, list
    // queries scan the whole table across all tenants. Applies to every table
    // built via buildEntityTable since every entity inherits tenantId.
    (table) => {
      const indexes: Record<string, IndexBuilderWithCols> = {};
      const tHandle = table as unknown as Record<string, ColumnHandle>;
      indexes[`${tableName}_tenant_id_idx`] = index(`${tableName}_tenant_id_idx`).on(
        // biome-ignore lint/style/noNonNullAssertion: tenantId column always exists on entity tables
        tHandle["tenantId"]!,
      );
      for (const fieldName of foreignKeyFields) {
        const column = tHandle[fieldName];
        if (column) {
          indexes[`${tableName}_${toSnakeCase(fieldName)}_idx`] = index(
            `${tableName}_${toSnakeCase(fieldName)}_idx`,
          ).on(column);
        }
      }
      // entity.indexes = composite/unique-Indices die der Author explizit
      // deklariert hat. Spalten werden via field-name (camelCase) angesprochen,
      // der Index-Name folgt der Convention <table>_<col1>_<col2>_<unique|idx>
      // — Override via index.name möglich.
      for (const def of entity.indexes ?? []) {
        const cols = def.columns
          .map((fieldName) => tHandle[fieldName])
          .filter((col): col is ColumnHandle => col !== undefined);
        if (cols.length !== def.columns.length) continue;
        const suffix = def.unique === true ? "unique" : "idx";
        const indexName =
          def.name ?? `${tableName}_${def.columns.map((c) => toSnakeCase(c)).join("_")}_${suffix}`;
        const builder = def.unique === true ? uniqueIndex(indexName) : index(indexName);
        let chain = builder.on(...cols);
        // entity.indexes[].where is now a SqlExpression (was drizzle SQL).
        // Pass through to the IndexBuilderWithCols.where()-API.
        if (def.where !== undefined) {
          chain = chain.where(def.where as SqlExpression);
        }
        indexes[indexName] = chain;
      }
      return indexes;
    },
  ) as unknown as EntityTable<E>;
}
