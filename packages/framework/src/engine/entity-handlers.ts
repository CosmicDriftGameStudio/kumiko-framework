import { type ZodType, z } from "zod";
import type { DbRow } from "../db/connection";
import type { TableColumns } from "../db/dialect";
import {
  collectReferenceFields,
  enrichRowWithReferences,
  enrichWithReferences,
} from "../db/eagerload";
import { createEventStoreExecutor, type EventStoreExecutor } from "../db/event-store-executor";
import { buildEntityTable } from "../db/table-builder";
import { assertUnreachable } from "../utils";
import { buildInsertSchema, buildUpdateSchema } from "./schema-builder";
import type { AccessRule, EntityDefinition, QueryHandlerDef, WriteHandlerDef } from "./types";

// Convention-based handler factories for event-sourced aggregates.
//
// You register one handler per call (no auto-generation of a whole CRUD set),
// but the Schema and the executor body are inferred from the entity + verb.
// Pick the verbs you need — leave out the ones you don't.
//
// Two API shapes — pick one per project, don't mix:
//
//   PREFERRED — one function per verb, type-safe, no magic strings:
//     r.writeHandler(defineEntityCreateHandler("note", noteEntity, { access }))
//     r.writeHandler(defineEntityUpdateHandler("note", noteEntity, { access }))
//     r.writeHandler(defineEntityDeleteHandler("note", noteEntity, { access }))
//     r.queryHandler(defineEntityListHandler("note", noteEntity, { access }))
//     r.queryHandler(defineEntityDetailHandler("note", noteEntity, { access }))
//
//   LEGACY — single function with verb in the name-string. Kept for
//   backwards-compat; existing apps work as before. New code should use
//   the verb-specific factories above:
//     r.writeHandler(defineEntityCreateHandler("note", noteEntity, { access }))
//     r.queryHandler(defineEntityDetailHandler("note", noteEntity, { access }))
//
// For custom logic (default values, business rules, side effects, custom
// executors with ctx.searchAdapter, ...) write the handler explicitly with
// r.writeHandler / r.queryHandler — these helpers cover the standard path only.
//
// Note on the `as` casts in the handler bodies: WriteHandlerDef.handler's
// payload type is `unknown` because the dispatcher hands the parsed payload
// through a runtime-only boundary. Each verb knows its post-parse shape (the
// schema we just built two lines up enforces it), so the casts are a
// localised re-declaration of that shape rather than a narrowing escape.

const WRITE_VERBS = ["create", "update", "delete", "restore"] as const;
const QUERY_VERBS = ["list", "detail"] as const;

type UpdatePayload = { id: string; version: number; changes: Record<string, unknown> };
type IdPayload = { id: string };
type ListPayload = {
  cursor?: string;
  limit?: number;
  search?: string;
  sort?: string;
  sortDirection?: "asc" | "desc";
  // Page-based Pagination: offset 0-basiert, mit limit zusammen statt
  // cursor genutzt. Cursor ist für infinite-scroll / live-tailing
  // präziser; offset ist für klassische Pager (← 1 2 ... N →) wo der
  // User direkt zu "page 7" springen will. Nur EINE Variante pro
  // Request — wenn beide gesetzt sind, gewinnt cursor (DB-stabil).
  offset?: number;
  // Wenn true, liefert der executor zusätzlich eine `total`-Zahl im
  // Response. Extra-Roundtrip auf der DB (COUNT(*)), nur dann sinnvoll
  // wenn der Pager "Page X of Y" rendern muss. Infinite-Scroll oder
  // unbedingte Lists lassen das weg um die COUNT-Kosten zu sparen.
  totalCount?: boolean;
  // Screen-Level Filter (Tier 2.7c) — Author-deklarierter, server-side
  // applizierter WHERE-Clause. Drei Buckets der selben Entity ohne
  // Custom-Pages: jedes Screen hat sein eigenes filter, alle nutzen
  // den gleichen Query-Handler.
  filter?: {
    readonly field: string;
    readonly op: "eq" | "ne" | "lt" | "gt" | "in";
    readonly value: unknown;
  };
};

const idSchema = z.object({ id: z.uuid() });
const listSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().optional(),
  search: z.string().optional(),
  sort: z.string().optional(),
  sortDirection: z.enum(["asc", "desc"]).optional(),
  offset: z.number().int().nonnegative().optional(),
  totalCount: z.boolean().optional(),
  filter: z
    .object({
      field: z.string(),
      op: z.enum(["eq", "ne", "lt", "gt", "in"]),
      // Value ist `unknown` zur Compile-Zeit; Server-Side prüft beim
      // Build der WHERE-Clause ob der Type zum Field passt. z.unknown()
      // lässt alles durch; Type-Check kommt im executor.list.
      value: z.unknown(),
    })
    .optional(),
});

function parseHandlerName<TVerb extends string>(
  name: string,
  validVerbs: readonly TVerb[],
): { entityName: string; verb: TVerb } {
  const colonIdx = name.indexOf(":");
  if (colonIdx < 0) {
    throw new Error(
      `Handler name "${name}" must use the "<entity>:<verb>" pattern (e.g. "note:create").`,
    );
  }
  const entityName = name.slice(0, colonIdx);
  const verbCandidate = name.slice(colonIdx + 1);
  if (!entityName) {
    throw new Error(`Handler name "${name}" is missing the entity part before the colon.`);
  }
  const verbs = validVerbs as readonly string[]; // @cast-boundary engine-bridge
  if (!verbs.includes(verbCandidate)) {
    throw new Error(
      `Unknown verb "${verbCandidate}" in handler name "${name}". Standard verbs: ${validVerbs.join("/")}. For custom verbs use the explicit r.writeHandler / r.queryHandler form.`,
    );
  }
  return { entityName, verb: verbCandidate as TVerb }; // @cast-boundary engine-bridge
}

export function defineEntityWriteHandler(
  name: string,
  entity: EntityDefinition,
  options?: { access?: AccessRule },
): WriteHandlerDef {
  const { entityName, verb } = parseHandlerName(name, WRITE_VERBS);
  if (verb === "restore" && !entity.softDelete) {
    throw new Error(
      `"${name}": restore is only valid for entities declared with softDelete: true.`,
    );
  }

  const table = buildEntityTable(entityName, entity);
  const executor = createEventStoreExecutor(table, entity, { entityName });

  let schema: ZodType;
  let handler: WriteHandlerDef["handler"];

  switch (verb) {
    case "create":
      schema = buildInsertSchema(entity);
      handler = async (event, ctx) => executor.create(event.payload as DbRow, event.user, ctx.db);
      break;
    case "update":
      schema = z.object({
        id: z.uuid(),
        version: z.number(),
        changes: buildUpdateSchema(entity),
      });
      handler = async (event, ctx) =>
        executor.update(event.payload as UpdatePayload, event.user, ctx.db); // @cast-boundary engine-payload
      break;
    case "delete":
      schema = idSchema;
      handler = async (event, ctx) =>
        executor.delete(event.payload as IdPayload, event.user, ctx.db); // @cast-boundary engine-payload
      break;
    case "restore":
      schema = idSchema;
      handler = async (event, ctx) =>
        executor.restore(event.payload as IdPayload, event.user, ctx.db); // @cast-boundary engine-payload
      break;
    default:
      assertUnreachable(verb, "write verb");
  }

  return {
    name,
    schema,
    handler,
    ...(options?.access && { access: options.access }),
  };
}

export function defineEntityQueryHandler(
  name: string,
  entity: EntityDefinition,
  options?: { access?: AccessRule },
): QueryHandlerDef {
  const { entityName, verb } = parseHandlerName(name, QUERY_VERBS);

  const table = buildEntityTable(entityName, entity);
  const executor = createEventStoreExecutor(table, entity, { entityName });

  let schema: ZodType;
  let handler: QueryHandlerDef["handler"];

  // Tier 2.7e Server-Eagerload: wenn die entity reference-Felder hat,
  // resolved der handler nach dem Haupt-Query die UUIDs gegen die
  // referenced entities. Das `_refs`-Property landet auf jeder Row;
  // Renderer-Side useReferenceLookup bleibt als Fallback bestehen
  // (für Apps die manuell Custom-Handler schreiben ohne diesen
  // Wrapper zu nutzen).
  const hasRefFields = collectReferenceFields(entity).length > 0;

  switch (verb) {
    case "list":
      schema = listSchema;
      handler = async (query, ctx) => {
        // Tier 2.7e Audit-Fix: SearchAdapter aus ctx durchreichen,
        // damit payload.search zur Laufzeit gegen Meilisearch/InMem
        // läuft (Remote-Combobox-Search). Der executor wird beim
        // Definition-Time gebaut, kennt den Adapter also nicht —
        // Runtime-Override holt das.
        const listPayload = query.payload as ListPayload; // @cast-boundary engine-payload
        const result = await executor.list(listPayload, query.user, ctx.db, {
          ...(ctx.searchAdapter !== undefined && { searchAdapter: ctx.searchAdapter }),
        });
        if (!hasRefFields) return result;
        const enrichedRows = await enrichWithReferences(
          result.rows,
          entity,
          (name) => ctx.registry.getEntity(name),
          ctx.db,
        );
        return { ...result, rows: enrichedRows };
      };
      break;
    case "detail":
      schema = idSchema;
      handler = async (query, ctx) => {
        const row = await executor.detail(query.payload as IdPayload, query.user, ctx.db); // @cast-boundary engine-payload
        if (row === null || !hasRefFields) return row;
        return enrichRowWithReferences(row, entity, (name) => ctx.registry.getEntity(name), ctx.db);
      };
      break;
    default:
      assertUnreachable(verb, "query verb");
  }

  return {
    name,
    schema,
    handler,
    ...(options?.access && { access: options.access }),
  };
}

// ─── Verb-specific factories (preferred) ──────────────────────────────
//
// One function per verb — verb is the function name, no magic-string
// parsing. Each delegates to the legacy `defineEntityWriteHandler` /
// `defineEntityQueryHandler` with a fixed verb-suffix; the schema +
// handler-body logic is unchanged. Migration from the legacy API is a
// 1:1 rename — same arguments minus the verb-prefix in the name-string.
//
// Why prefer these over the legacy form:
//   - Verb is checked at compile-time (no runtime "Unknown verb" throw)
//   - IDE auto-completes the four/two verbs after typing `defineEntity`
//   - Function name is self-documenting; no comment needed to explain
//   - Entity-name appears once (used to be doubled: once in the string,
//     once as the entity-arg)
//
// Restore-specific note: defineEntityRestoreHandler still validates at
// runtime that entity.softDelete === true. A compile-time-only check
// would need a Branded-EntityDefinition with `softDelete: true` literal
// — feasible but not yet wired; the runtime guard catches misuse.

type EntityHandlerOptions = { readonly access?: AccessRule };

export function defineEntityCreateHandler(
  entityName: string,
  entity: EntityDefinition,
  options?: EntityHandlerOptions,
): WriteHandlerDef {
  return defineEntityWriteHandler(`${entityName}:create`, entity, options);
}

export function defineEntityUpdateHandler(
  entityName: string,
  entity: EntityDefinition,
  options?: EntityHandlerOptions,
): WriteHandlerDef {
  return defineEntityWriteHandler(`${entityName}:update`, entity, options);
}

export function defineEntityDeleteHandler(
  entityName: string,
  entity: EntityDefinition,
  options?: EntityHandlerOptions,
): WriteHandlerDef {
  return defineEntityWriteHandler(`${entityName}:delete`, entity, options);
}

export function defineEntityRestoreHandler(
  entityName: string,
  entity: EntityDefinition,
  options?: EntityHandlerOptions,
): WriteHandlerDef {
  return defineEntityWriteHandler(`${entityName}:restore`, entity, options);
}

export function defineEntityListHandler(
  entityName: string,
  entity: EntityDefinition,
  options?: EntityHandlerOptions,
): QueryHandlerDef {
  return defineEntityQueryHandler(`${entityName}:list`, entity, options);
}

export function defineEntityDetailHandler(
  entityName: string,
  entity: EntityDefinition,
  options?: EntityHandlerOptions,
): QueryHandlerDef {
  return defineEntityQueryHandler(`${entityName}:detail`, entity, options);
}

// biome-ignore lint/suspicious/noExplicitAny: Drizzle dynamic table — erased on purpose, same as db/event-store-executor.ts does.
type AnyTable = TableColumns<any>;

// Bundle the two calls every custom write-handler opens with: build the
// Drizzle table from the entity, then wire an event-store executor onto it.
// The pair is identical in every sample that hand-writes handlers, so the
// helper collapses 3-4 lines + the { entityName } bookkeeping into one.
//
//   const { table, executor } = createEntityExecutor("counter", counterEntity);
//
// Keep using the explicit buildEntityTable / createEventStoreExecutor duo
// when you need search-adapter / entity-cache options on the executor — this
// helper covers the zero-config case.
export function createEntityExecutor(
  entityName: string,
  entity: EntityDefinition,
): { readonly table: AnyTable; readonly executor: EventStoreExecutor } {
  const table = buildEntityTable(entityName, entity);
  const executor = createEventStoreExecutor(table, entity, { entityName });
  return { table, executor };
}

// Wrap a projection read into a zero-argument query handler. Use when the
// read is "give me all rows from projection X, tenant-scoped" — the common
// shape for list-views backed by an MSP/projection table.
//
//   r.queryHandler(
//     defineProjectionQueryHandler("revenue:list", "showcase:projection:customer-revenue", {
//       access: { openToAll: true },
//     }),
//   );
//
// For anything more involved (filters, joins, custom shaping), write the
// query-handler explicitly with ctx.queryProjection or a raw select.
export function defineProjectionQueryHandler(
  name: string,
  projectionQualifiedName: string,
  options?: { access?: AccessRule; unsafeAllTenants?: boolean },
): QueryHandlerDef {
  return {
    name,
    schema: z.object({}),
    // Returns the raw row array — matches ctx.queryProjection's shape so the
    // helper is a drop-in for the inline `async (_q, ctx) => ctx.queryProjection(...)`
    // handler. Wrap the result in the caller's handler when you need
    // pagination envelopes or added metadata.
    handler: async (_query, ctx) =>
      ctx.queryProjection(
        projectionQualifiedName,
        options?.unsafeAllTenants ? { unsafeAllTenants: true } : undefined,
      ),
    ...(options?.access && { access: options.access }),
  };
}
