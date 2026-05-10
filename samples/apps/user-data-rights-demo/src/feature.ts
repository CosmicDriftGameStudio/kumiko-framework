// kumiko-feature-version: 1
//
// todos — Demo-Domain-Feature, das ueber EXT_USER_DATA in user-data-
// rights integriert. Ein App-Author registriert pro Domain-Entity einen
// (export, delete)-Hook — das war es. Forget-Cron, Export-Bundle und
// DSGVO-Endpoints kommen vollstaendig aus user-data-rights.
//
// Dieses Feature zeigt:
//   - r.entity("todo", todoEntity)            → Drizzle-Tabelle wird gebaut
//   - r.writeHandler("create")                → User legt Todo an
//   - r.queryHandler("list")                  → User sieht seine Todos
//   - r.useExtension(EXT_USER_DATA, "todo")   → Forget + Export integration
//
// Was passiert wenn der User dann request-export aufruft:
//   1. user-data-rights.request-export.write triggert einen Job
//   2. Worker iteriert alle EXT_USER_DATA-Provider (user, fileRef, todo)
//   3. todoExportHook liest alle Rows mit author_id = userId aus
//      ALLEN Tenants des Users
//   4. Bundle wird als ZIP an einen signed-Magic-Link gepackt + per
//      Email verschickt
//
// Was passiert wenn der User request-deletion aufruft:
//   1. user-data-rights setzt status=DeletionRequested + grace
//   2. Nach Ablauf laeuft der run-forget-cleanup-Cron
//   3. todoDeleteHook DELETEt alle Rows mit author_id = userId
//   4. user wird anonymisiert (display_name="(deleted)", email=null)

import { buildDrizzleTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createTextField,
  defineFeature,
  defineQueryHandler,
  defineWriteHandler,
  EXT_USER_DATA,
  type UserDataDeleteHook,
  type UserDataExportHook,
} from "@cosmicdrift/kumiko-framework/engine";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const FEATURE_NAME = "todos";

export const todoEntity = createEntity({
  table: "read_todos",
  idType: "uuid",
  fields: {
    authorId: createTextField({ required: true }),
    title: createTextField({ required: true, maxLength: 200 }),
    body: createTextField({ maxLength: 4000 }),
  },
});

export const todosTable = buildDrizzleTable("todo", todoEntity);

const createSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(4000).optional(),
});

const createTodoHandler = defineWriteHandler({
  name: "create",
  schema: createSchema,
  access: { openToAll: true },
  handler: async (event, ctx) => {
    const id = crypto.randomUUID();
    await ctx.db.insert(todosTable).values({
      id,
      tenantId: event.user.tenantId,
      authorId: event.user.id,
      title: event.payload.title,
      body: event.payload.body ?? "",
    });
    return { isSuccess: true as const, data: { id } };
  },
});

const listTodosHandler = defineQueryHandler({
  name: "list",
  schema: z.object({}),
  access: { openToAll: true },
  handler: async (query, ctx) => {
    const rows = await ctx.db
      .select({
        id: todosTable["id"],
        title: todosTable["title"],
        body: todosTable["body"],
      })
      .from(todosTable)
      .where(eq(todosTable["authorId"], query.user.id));
    return { rows };
  },
});

export const todosFeature = defineFeature(FEATURE_NAME, (r) => {
  r.requires("user-data-rights");

  r.entity("todo", todoEntity);
  r.writeHandler(createTodoHandler);
  r.queryHandler(listTodosHandler);

  // EXT_USER_DATA-Hooks: wie todos zu DSGVO-Pipeline beitragen.
  // Cross-tenant: Hook wird pro Tenant des Users aufgerufen — wir filtern
  // hier on (tenantId, authorId), beide kommen aus dem ctx.
  const exportTodos: UserDataExportHook = async (ctx) => {
    const rows = await ctx.db
      .select({
        id: todosTable["id"],
        title: todosTable["title"],
        body: todosTable["body"],
      })
      .from(todosTable)
      .where(and(eq(todosTable["tenantId"], ctx.tenantId), eq(todosTable["authorId"], ctx.userId)));
    if (rows.length === 0) return null;
    return {
      entity: "todo",
      rows: rows.map((row) => ({
        id: String(row["id"]),
        title: row["title"] ?? "",
        body: row["body"] ?? "",
      })),
    };
  };

  // Strategy = "delete" → hard-delete; "anonymize" → authorId=null,
  // Row bleibt fuer Multi-User-Scenarios. Fuer todos macht only-author
  // wenig Sinn → wir delete'n immer.
  const deleteTodos: UserDataDeleteHook = async (ctx, _strategy) => {
    await ctx.db
      .delete(todosTable)
      .where(and(eq(todosTable["tenantId"], ctx.tenantId), eq(todosTable["authorId"], ctx.userId)));
  };

  r.useExtension(EXT_USER_DATA, "todo", {
    export: exportTodos,
    delete: deleteTodos,
  });
});

export const TODO_CREATE_QN = "todos:write:create";
export const TODO_LIST_QN = "todos:query:list";
