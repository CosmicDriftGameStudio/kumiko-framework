import { type ZodType, z } from "zod";
import type { DbRow } from "../db/connection";
import type { TableColumns } from "../db/dialect";
import { createEventStoreExecutor, type EventStoreExecutor } from "../db/event-store-executor";
import { buildDrizzleTable } from "../db/table-builder";
import { assertUnreachable } from "../utils";
import { buildInsertSchema, buildUpdateSchema } from "./schema-builder";
import type { AccessRule, EntityDefinition, QueryHandlerDef, WriteHandlerDef } from "./types";

// Convention-based handler factories for event-sourced aggregates.
//
// You register one handler per call (no auto-generation of a whole CRUD set),
// but the Schema and the executor body are inferred from the entity + verb.
// Pick the verbs you need — leave out the ones you don't.
//
//   r.writeHandler(defineEntityWriteHandler("note:create", noteEntity, { access }))
//   r.queryHandler(defineEntityQueryHandler("note:detail", noteEntity, { access }))
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
};

const idSchema = z.object({ id: z.uuid() });
const listSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().optional(),
  search: z.string().optional(),
  sort: z.string().optional(),
  sortDirection: z.enum(["asc", "desc"]).optional(),
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
  if (!(validVerbs as readonly string[]).includes(verbCandidate)) {
    throw new Error(
      `Unknown verb "${verbCandidate}" in handler name "${name}". Standard verbs: ${validVerbs.join("/")}. For custom verbs use the explicit r.writeHandler / r.queryHandler form.`,
    );
  }
  return { entityName, verb: verbCandidate as TVerb };
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

  const table = buildDrizzleTable(entityName, entity);
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
        executor.update(event.payload as UpdatePayload, event.user, ctx.db);
      break;
    case "delete":
      schema = idSchema;
      handler = async (event, ctx) =>
        executor.delete(event.payload as IdPayload, event.user, ctx.db);
      break;
    case "restore":
      schema = idSchema;
      handler = async (event, ctx) =>
        executor.restore(event.payload as IdPayload, event.user, ctx.db);
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

  const table = buildDrizzleTable(entityName, entity);
  const executor = createEventStoreExecutor(table, entity, { entityName });

  let schema: ZodType;
  let handler: QueryHandlerDef["handler"];

  switch (verb) {
    case "list":
      schema = listSchema;
      handler = async (query, ctx) =>
        executor.list(query.payload as ListPayload, query.user, ctx.db);
      break;
    case "detail":
      schema = idSchema;
      handler = async (query, ctx) =>
        executor.detail(query.payload as IdPayload, query.user, ctx.db);
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

// biome-ignore lint/suspicious/noExplicitAny: Drizzle dynamic table — erased on purpose, same as db/event-store-executor.ts does.
type AnyTable = TableColumns<any>;

// Bundle the two calls every custom write-handler opens with: build the
// Drizzle table from the entity, then wire an event-store executor onto it.
// The pair is identical in every sample that hand-writes handlers, so the
// helper collapses 3-4 lines + the { entityName } bookkeeping into one.
//
//   const { table, executor } = createEntityExecutor("counter", counterEntity);
//
// Keep using the explicit buildDrizzleTable / createEventStoreExecutor duo
// when you need search-adapter / entity-cache options on the executor — this
// helper covers the zero-config case.
export function createEntityExecutor(
  entityName: string,
  entity: EntityDefinition,
): { readonly table: AnyTable; readonly executor: EventStoreExecutor } {
  const table = buildDrizzleTable(entityName, entity);
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
  options?: { access?: AccessRule; allTenants?: boolean },
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
        options?.allTenants ? { allTenants: true } : undefined,
      ),
    ...(options?.access && { access: options.access }),
  };
}
