import { z } from "zod";
import type { DbRow } from "../db/connection";
import { createEventStoreExecutor } from "../db/event-store-executor";
import { buildDrizzleTable } from "../db/table-builder";
import { buildInsertSchema, buildUpdateSchema } from "./schema-builder";
import type {
  AccessRule,
  EntityDefinition,
  EntityRelations,
  QueryHandlerDef,
  WriteHandlerDef,
} from "./types";

// Access can be a single rule (applied to every generated handler) or a
// per-handler map. The per-handler form is preferred for anything beyond
// a throwaway sample — `create/update/delete` usually want "edit-rights"
// while `list/detail` want "read-rights".
type PerHandlerAccess = {
  readonly create?: AccessRule;
  readonly update?: AccessRule;
  readonly delete?: AccessRule;
  readonly restore?: AccessRule;
  readonly list?: AccessRule;
  readonly detail?: AccessRule;
};

type CrudOptions = {
  access?: AccessRule | PerHandlerAccess;
  relations?: EntityRelations;
  featureName?: string;
};

function isPerHandlerAccess(access: AccessRule | PerHandlerAccess): access is PerHandlerAccess {
  // AccessRule is one of: { roles: [...] } | { openToAll: true } | { authenticated: true } | ...
  // PerHandlerAccess has keys like create/update/delete etc. A single rule
  // never has those keys, so presence of any CRUD verb signals the per-
  // handler shape.
  const obj = access as DbRow;
  return (
    "create" in obj ||
    "update" in obj ||
    "delete" in obj ||
    "restore" in obj ||
    "list" in obj ||
    "detail" in obj
  );
}

function accessFor(
  access: AccessRule | PerHandlerAccess | undefined,
  verb: keyof PerHandlerAccess,
): AccessRule | undefined {
  if (!access) return undefined;
  if (isPerHandlerAccess(access)) return access[verb];
  return access;
}

type CrudHandlers = {
  writeHandlers: Record<string, WriteHandlerDef>;
  queryHandlers: Record<string, QueryHandlerDef>;
};

// Full CRUD-handler generation — writes go through the event-store-executor
// (events + projection in one TX), reads come from the projection table. The
// entity must declare `idType: "uuid"` since event aggregates are UUID-keyed
// end-to-end; a friendly runtime error beats a cryptic failure at first write.
export function buildCrudHandlers(
  entityName: string,
  entity: EntityDefinition,
  options?: CrudOptions,
): CrudHandlers {
  if (entity.idType !== "uuid") {
    throw new Error(
      `r.crud("${entityName}") requires idType: "uuid" on the entity — event-sourced aggregates are UUID-keyed.`,
    );
  }

  // Build the Drizzle table once and bake it into the handlers via closure.
  // Same shape as `buildDrizzleTable` outside the registrar — users that need
  // the table reference for custom queries can build it independently; the
  // resulting SQL is identical.
  const table = buildDrizzleTable(entityName, entity, {
    ...(options?.featureName && { featureName: options.featureName }),
    ...(options?.relations && { relations: options.relations }),
  });
  const executor = createEventStoreExecutor(table, entity, { entityName });

  const insertSchema = buildInsertSchema(entity);
  const updateSchema = buildUpdateSchema(entity);
  const access = options?.access;
  const spreadAccess = (verb: keyof PerHandlerAccess) => {
    const rule = accessFor(access, verb);
    return rule ? { access: rule } : {};
  };

  const writeHandlers: Record<string, WriteHandlerDef> = {
    [`${entityName}:create`]: {
      name: `${entityName}:create`,
      schema: insertSchema,
      handler: async (event, ctx) => executor.create(event.payload as DbRow, event.user, ctx.db),
      ...spreadAccess("create"),
    },
    [`${entityName}:update`]: {
      name: `${entityName}:update`,
      schema: z.object({
        id: z.uuid(),
        version: z.number(),
        changes: updateSchema,
      }),
      handler: async (event, ctx) =>
        executor.update(
          event.payload as { id: string; version: number; changes: Record<string, unknown> },
          event.user,
          ctx.db,
        ),
      ...spreadAccess("update"),
    },
    [`${entityName}:delete`]: {
      name: `${entityName}:delete`,
      schema: z.object({ id: z.uuid() }),
      handler: async (event, ctx) =>
        executor.delete(event.payload as { id: string }, event.user, ctx.db),
      ...spreadAccess("delete"),
    },
  };

  if (entity.softDelete) {
    writeHandlers[`${entityName}:restore`] = {
      name: `${entityName}:restore`,
      schema: z.object({ id: z.uuid() }),
      handler: async (event, ctx) =>
        executor.restore(event.payload as { id: string }, event.user, ctx.db),
      ...spreadAccess("restore"),
    };
  }

  type ListPayload = {
    cursor?: string;
    limit?: number;
    search?: string;
    sort?: string;
    sortDirection?: "asc" | "desc";
  };

  const queryHandlers: Record<string, QueryHandlerDef> = {
    [`${entityName}:list`]: {
      name: `${entityName}:list`,
      schema: z.object({
        cursor: z.string().optional(),
        limit: z.number().optional(),
        search: z.string().optional(),
        sort: z.string().optional(),
        sortDirection: z.enum(["asc", "desc"]).optional(),
      }),
      handler: async (query, ctx) =>
        executor.list(query.payload as ListPayload, query.user, ctx.db),
      ...spreadAccess("list"),
    },
    [`${entityName}:detail`]: {
      name: `${entityName}:detail`,
      schema: z.object({ id: z.uuid() }),
      handler: async (query, ctx) =>
        executor.detail(query.payload as { id: string }, query.user, ctx.db),
      ...spreadAccess("detail"),
    },
  };

  return { writeHandlers, queryHandlers };
}
