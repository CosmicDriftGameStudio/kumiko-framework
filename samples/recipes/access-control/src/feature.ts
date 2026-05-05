// Access Control + FK-Indices Sample
//
// Demonstrates the framework's security + performance defaults:
//
//  1. Default-deny: every handler must declare an access rule. Boot fails
//     loudly when one is missing. Two shapes:
//       { roles: ["Admin", ...] } — role allowlist
//       { openToAll: true }       — any authenticated user
//
//  2. Foreign-key relations declared via r.relation() become indexed columns
//     automatically — no manual CREATE INDEX. Inspect the Drizzle table
//     config in tests to verify.

import { buildDrizzleTable, createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createTextField,
  defineEntityCreateHandler,
  defineEntityListHandler,
  defineFeature,
  defineRoles,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

// Typed role registry — `defineRoles` returns an object keyed by role name
// so access rules can reference `AccessControlRoles.Admin` instead of the
// magic string "Admin". Typos become compile errors, renames refactor.
export const AccessControlRoles = defineRoles(["Admin"] as const);

export const projectEntity = createEntity({
  table: "read_ac_projects",
  fields: {
    name: createTextField({ required: true }),
    ownerId: createTextField({ required: true }),
  },
});

export const taskEntity = createEntity({
  table: "read_ac_tasks",
  fields: {
    title: createTextField({ required: true }),
    assigneeId: createTextField(),
    projectId: createTextField({ required: true }),
  },
});

// The "owner" relation points at a hypothetical external `user` entity — in
// a real app this would be @cosmicdrift/kumiko-bundled-features/user. For the sample we
// keep it internal: projectRelations only holds FK metadata (no cross-entity
// resolution) so the sample stays self-contained.
export const projectRelations = {} as const;

export const taskRelations = {
  project: { type: "belongsTo", target: "project", foreignKey: "projectId" },
} as const;

// Relations flow into buildDrizzleTable — every belongsTo FK gets its own
// index on this table.
export const projectTable = buildDrizzleTable("project", projectEntity, {
  relations: projectRelations,
});
export const taskTable = buildDrizzleTable("task", taskEntity, {
  relations: taskRelations,
});

export const accessControlFeature = defineFeature("access-control", (r) => {
  r.entity("project", projectEntity);
  r.entity("task", taskEntity);
  r.relation("task", "project", taskRelations.project);

  // Admin-only: standard create — no business logic, helper handles schema +
  // executor + handler-body.
  r.writeHandler(
    defineEntityCreateHandler("project", projectEntity, {
      access: { roles: [AccessControlRoles.Admin] },
    }),
  );

  // Custom create: assigneeId defaults to the caller when omitted, so we
  // hand-write this handler instead of using the helper. The framework helpers
  // are deliberately scope-limited — opt out the moment you need defaults.
  const taskExecutor = createEventStoreExecutor(taskTable, taskEntity, { entityName: "task" });
  r.writeHandler(
    "task:create",
    z.object({
      title: z.string().min(1),
      projectId: z.uuid(),
      assigneeId: z.uuid().optional(),
    }),
    async (event, ctx) =>
      taskExecutor.create(
        {
          ...event.payload,
          assigneeId: event.payload.assigneeId ?? event.user.id,
        },
        event.user,
        ctx.db,
      ),
    { access: { openToAll: true } },
  );

  // Update requires version — optimistic locking is the default and this
  // narrowed schema (only title + assigneeId mutable) is stricter than the
  // helper's generic update schema, so we keep it hand-written.
  r.writeHandler(
    "task:update",
    z.object({
      id: z.uuid(),
      version: z.number(),
      changes: z.object({
        title: z.string().min(1).optional(),
        assigneeId: z.uuid().optional(),
      }),
    }),
    async (event, ctx) => taskExecutor.update(event.payload, event.user, ctx.db),
    { access: { openToAll: true } },
  );

  // Self-service list — no custom logic.
  r.queryHandler(defineEntityListHandler("task", taskEntity, { access: { openToAll: true } }));
});
