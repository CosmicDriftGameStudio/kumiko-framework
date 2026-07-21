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

import {
  buildEntityTableMeta,
  deleteMany,
  insertOne,
  selectMany,
  updateMany,
} from "@cosmicdrift/kumiko-framework/db";
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
import { z } from "zod";

const FEATURE_NAME = "todos";

export const todoEntity = createEntity({
  table: "store_todos",
  idType: "uuid",
  fields: {
    // nullable: bei DSGVO-anonymize wird authorId auf null gesetzt
    // (Row bleibt, Personenbezug raus). Pattern matched fileRef.
    authorId: createTextField({}),
    title: createTextField({ required: true, maxLength: 200 }),
    body: createTextField({ maxLength: 4000 }),
  },
});

// Plain EntityTableMeta, NOT a branded EntityTable: store_todos is a deliberate
// unmanaged direct-write store (r.storeTable below), so the create handler +
// forget hook write it directly — the meta carries no executor-only brand.
export const todosTable = buildEntityTableMeta("todo", todoEntity, { source: "unmanaged" });

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
    await insertOne(ctx.db, todosTable, {
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
    const rows = await selectMany<{ id: string; title: string; body: string }>(ctx.db, todosTable, {
      authorId: query.user.id,
    });
    return { rows };
  },
});

export const todosFeature = defineFeature(FEATURE_NAME, (r) => {
  r.requires("user-data-rights");

  // store_todos is a direct-write store: the create handler `insertOne`s and
  // the forget hook `updateMany`/`deleteMany`s rows WITHOUT emitting lifecycle
  // events. Registering it as r.entity would make it a rebuildable implicit
  // projection whose replay finds zero todo events and swaps an empty shadow
  // over the live table — wiping every todo (and silently un-forgetting
  // anonymized rows) on the next projection rebuild (#498). r.storeTable
  // keeps the migration DDL but opts the table out of implicit rebuild.
  r.storeTable(todosTable, {
    reason: "read_side.todos_direct_write",
  });
  r.writeHandler(createTodoHandler);
  r.queryHandler(listTodosHandler);

  // EXT_USER_DATA-Hooks: wie todos zu DSGVO-Pipeline beitragen.
  // Cross-tenant: Hook wird pro Tenant des Users aufgerufen — wir filtern
  // hier on (tenantId, authorId), beide kommen aus dem ctx.
  const exportTodos: UserDataExportHook = async (ctx) => {
    const rows = await selectMany<{ id: string; title: string; body: string }>(ctx.db, todosTable, {
      tenantId: ctx.tenantId,
      authorId: ctx.userId,
    });
    if (rows.length === 0) return null;
    return {
      entity: "todo",
      rows: rows.map((row) => ({
        id: String(row.id),
        title: row.title ?? "",
        body: row.body ?? "",
      })),
    };
  };

  // Strategy-aware: bei "anonymize" bleibt die Row (authorId=null) damit
  // Multi-User-Refs intakt bleiben; bei "delete" hard-delete. Compliance-
  // Profile (DE-HR, Steuer) koennen via retention.strategy=anonymize den
  // anonymize-Pfad triggern statt hardDelete. Pattern matched fileRef-hook.
  const deleteTodos: UserDataDeleteHook = async (ctx, strategy) => {
    const where = { tenantId: ctx.tenantId, authorId: ctx.userId };
    if (strategy === "anonymize") {
      await updateMany(ctx.db, todosTable, { authorId: null }, where);
    } else {
      await deleteMany(ctx.db, todosTable, where);
    }
  };

  r.useExtension(EXT_USER_DATA, "todo", {
    export: exportTodos,
    delete: deleteTodos,
  });

  // Wire-proof for the read-only GDPR inspector screens: an app opts in by
  // navigating the (otherwise inert) bundled screens. SystemAdmin-gated, so
  // they surface only for platform operators. This nav is the ONLY wiring an
  // app needs — the screens and convention handlers live in user-data-rights.
  r.nav({
    id: "gdpr-export-jobs",
    label: "GDPR · Export Jobs",
    screen: "user-data-rights:screen:export-job-list",
    access: { roles: ["SystemAdmin"] },
    order: 90,
  });
  r.nav({
    id: "gdpr-download-attempts",
    label: "GDPR · Download Attempts",
    screen: "user-data-rights:screen:download-attempt-list",
    access: { roles: ["SystemAdmin"] },
    order: 91,
  });
});

export const TODO_CREATE_QN = "todos:write:create";
export const TODO_LIST_QN = "todos:query:list";
