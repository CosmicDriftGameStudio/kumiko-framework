import { sql } from "drizzle-orm";
import type { EntityDefinition, EntityRelations, FieldDefinition } from "../engine/types";
import { assertUnreachable } from "../utils";
import {
  boolean,
  index,
  instant,
  integer,
  jsonb,
  moneyAmount,
  table as pgTable,
  serial,
  type TableColumns,
  text,
  uniqueIndex,
  uuid,
} from "./dialect";

type ColumnBuilder =
  | ReturnType<typeof text>
  | ReturnType<typeof integer>
  | ReturnType<typeof boolean>
  | ReturnType<typeof moneyAmount>
  | ReturnType<typeof jsonb>
  | ReturnType<typeof instant>
  | ReturnType<typeof serial>
  | ReturnType<typeof uuid>;

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
): Record<string, ColumnBuilder> {
  const snakeName = toSnakeCase(name);

  switch (field.type) {
    case "text": {
      const col = text(snakeName);
      return { [name]: field.required ? col.notNull() : col };
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
    case "date": {
      // TODO(Sprint G): semantisch falsch — `type:"date"` sollte
      // Temporal.PlainDate sein (PG `date` Spalte, kein TZ). Heute aliased auf
      // instant() = TIMESTAMPTZ damit Caller die gleiche API nutzen wie für
      // type:"timestamp". Echte PlainDate-Migration kommt nach Sprint F.
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

// biome-ignore lint/suspicious/noExplicitAny: Drizzle dynamic tables lose column types
type DrizzleTable = TableColumns<any>;

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

export type BuildDrizzleTableOptions = {
  readonly featureName?: string;
  // Relations declared for this entity. When present, every belongsTo
  // foreignKey gets an index — otherwise joins and `WHERE fk = ?` filters
  // sequential-scan the child table. Pass the output of
  // `registry.getRelations(entityName)` or the raw relations block.
  readonly relations?: EntityRelations;
};

export function buildDrizzleTable(
  entityName: string,
  entity: EntityDefinition,
  options?: BuildDrizzleTableOptions,
): DrizzleTable {
  const baseColumns = buildBaseColumns(entity.softDelete ?? false, entity.idType ?? "uuid");
  const fieldColumns: Record<string, ColumnBuilder> = {};

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

  return pgTable(
    tableName,
    {
      ...baseColumns,
      ...fieldColumns,
    },
    // Every multi-tenant query filters by tenant_id. Without this index, list
    // queries scan the whole table across all tenants. Applies to every table
    // built via buildDrizzleTable since every entity inherits tenantId.
    // biome-ignore lint/suspicious/noExplicitAny: Drizzle's table callback is generic; we access columns by their JS property name.
    (table: any) => {
      const indexes = [index(`${tableName}_tenant_id_idx`).on(table.tenantId)];
      for (const fieldName of foreignKeyFields) {
        const column = table[fieldName];
        if (column) {
          indexes.push(index(`${tableName}_${toSnakeCase(fieldName)}_idx`).on(column));
        }
      }
      // entity.indexes = composite/unique-Indices die der Author explizit
      // deklariert hat. Spalten werden via field-name (camelCase) angesprochen,
      // der Index-Name folgt der Convention <table>_<col1>_<col2>_<unique|idx>
      // — Override via index.name möglich.
      for (const def of entity.indexes ?? []) {
        const cols = def.columns
          .map((fieldName) => table[fieldName])
          .filter((col): col is unknown => col !== undefined);
        if (cols.length !== def.columns.length) continue; // Boot-Validator catched das
        const suffix = def.unique === true ? "unique" : "idx";
        const indexName =
          def.name ?? `${tableName}_${def.columns.map((c) => toSnakeCase(c)).join("_")}_${suffix}`;
        const builder = def.unique === true ? uniqueIndex(indexName) : index(indexName);
        // biome-ignore lint/suspicious/noExplicitAny: drizzle's .on(...cols) is variadic generic
        indexes.push((builder.on as any)(...cols));
      }
      return indexes;
    },
  );
}
