// defineQueryHandler with a crossTenantReads grant: ctx.crossTenantReads is typed non-optional
// (no guard below) and wired by the real stack; agent tool calls are denied by the dispatch check.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import type { EscapeHatchUseEvent } from "@cosmicdrift/kumiko-types/handlers";
import * as z from "zod";
import { runAsAgentToolCallEntry } from "../../api/request-context.ts";
import { createEventStoreExecutor } from "../../db/event-store-executor.ts";
import { buildEntityTable } from "../../db/table-builder.ts";
import { eventsTable } from "../../event-store/index.ts";
import { createTestUser, testTenantId } from "../../seeding/seed-users.ts";
import { defineQueryHandler } from "../define-handler.ts";
import { createEntity, createTextField, defineFeature } from "../index.ts";

const noteEntity = createEntity({
  name: "note",
  table: "define_xtr_notes",
  fields: { title: createTextField({ required: true, personal: false, reason: "test_fixture" }) },
});
const noteTable = buildEntityTable(noteEntity);
const noteExecutor = createEventStoreExecutor(noteTable, noteEntity, { entityName: "note" });

const FEATURE = "define-xtr";
const GRANTED_COUNT = `${FEATURE}:query:granted-count`;

const grantedCount = defineQueryHandler({
  name: "granted-count",
  schema: z.object({}),
  access: { roles: ["Admin"] },
  escapeHatch: {
    reason: "define-handler typed cross-tenant count probe",
    grants: ["crossTenantReads"],
  },
  handler: async (_query, ctx) => ({ count: await ctx.crossTenantReads.count(noteTable) }),
});

const feature = defineFeature(FEATURE, (r) => {
  r.entity(noteEntity);

  r.writeHandler({
    name: "add-note",
    schema: z.object({ title: z.string() }),
    access: { roles: ["Admin"] },
    handler: async (event, ctx) => {
      const created = await noteExecutor.create({ title: event.payload.title }, ctx.user, ctx.db);
      return created.isSuccess ? { isSuccess: true as const, data: {} } : created;
    },
  });

  r.queryHandler(grantedCount);
});

const ownAdmin = createTestUser({ id: 1, tenantId: testTenantId(9611), roles: ["Admin"] });
const foreignAdmin = createTestUser({ id: 2, tenantId: testTenantId(9612), roles: ["Admin"] });

const auditEvents: EscapeHatchUseEvent[] = [];
let stack: TestStack;

const crossTenantReadEvents = (): EscapeHatchUseEvent[] =>
  auditEvents.filter((e) => e.kind === "cross-tenant-read");

beforeAll(async () => {
  stack = await setupTestStack({
    features: [feature],
    extraContext: {
      _escapeHatchAuditSink: async (event: EscapeHatchUseEvent) => {
        auditEvents.push(event);
      },
    },
  });
  await unsafeCreateEntityTable(stack.db, noteEntity, "note");
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [noteTable, eventsTable]);
  await stack.http.writeOk(`${FEATURE}:write:add-note`, { title: "own-note" }, ownAdmin);
  await stack.http.writeOk(`${FEATURE}:write:add-note`, { title: "foreign-note" }, foreignAdmin);
  auditEvents.length = 0;
});

describe("defineQueryHandler with a crossTenantReads grant", () => {
  test("reads across tenants through the typed ctx.crossTenantReads and audits once", async () => {
    const result = await stack.http.queryOk(GRANTED_COUNT, {}, ownAdmin);

    expect(result).toEqual({ count: 2 });
    expect(crossTenantReadEvents()).toHaveLength(1);
  });

  test("an agent tool call is denied before the handler runs", async () => {
    await expect(
      runAsAgentToolCallEntry(() => stack.dispatcher.query(GRANTED_COUNT, {}, ownAdmin)),
    ).rejects.toMatchObject({ code: "access_denied" });
    expect(crossTenantReadEvents()).toEqual([]);
  });
});
