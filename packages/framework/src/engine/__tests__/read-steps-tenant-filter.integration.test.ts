// fw#2914 — r.step.read.findOne/findMany now apply the caller's tenant
// filter by default (own tenant + SYSTEM_TENANT_ID reference rows), like
// ctx.db method-form reads. Cross-tenant reads need `unsafeAllTenants:
// { reason }` on the step AND `escapeHatch: { reason }` on the handler,
// reported as an "unsafe-raw" escape-hatch audit event. Real HTTP calls +
// setupTestStack — never createTestDispatcher. Modelled on the M.1.5
// section of pipeline-handler.integration.test.ts and
// escape-hatch-audit.integration.test.ts.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as z from "zod";
import { table, text, uuid } from "../../db/dialect";
import { insertOne } from "../../db/query";
import { defineFeature, defineWriteHandler } from "../../engine";
import { setupTestStack, type TestStack, TestUsers, unsafePushTables } from "../../stack";
import { stepsPipeline } from "../pipeline";
import type { EscapeHatchUseEvent } from "../types";

const readFilterTable = table("fw2914_read_filter_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  label: text("label").notNull(),
});

const UNDECLARED_REASON =
  "fw#2914 integration test — cross-tenant read step without a handler grant";
const ESCAPED_REASON = "fw#2914 integration test — cross-tenant widget count for read step";

const listSchema = z.object({});
const listHandler = defineWriteHandler({
  name: "list",
  schema: listSchema,
  access: { roles: ["Admin"] },
  perform: stepsPipeline<z.infer<typeof listSchema>, { count: number; ids: string[] }>(({ r }) => [
    r.step.read.findMany("items", { table: readFilterTable }),
    r.step.return(({ steps }) => {
      const rows = steps["items"] as readonly { id: string }[];
      return {
        isSuccess: true as const,
        data: { count: rows.length, ids: rows.map((row) => row.id) },
      };
    }),
  ]),
});

const getSchema = z.object({ id: z.uuid() });
const getHandler = defineWriteHandler({
  name: "get",
  schema: getSchema,
  access: { roles: ["Admin"] },
  perform: stepsPipeline<z.infer<typeof getSchema>, { found: boolean; label: string | null }>(
    ({ event, r }) => [
      r.step.read.findOne("item", {
        table: readFilterTable,
        where: () => ({ id: event.payload.id }),
      }),
      r.step.return(({ steps }) => {
        const row = steps["item"] as { label?: string } | null;
        return {
          isSuccess: true as const,
          data: { found: row !== null, label: row?.label ?? null },
        };
      }),
    ],
  ),
});

const listUnsafeUndeclaredSchema = z.object({});
const listUnsafeUndeclaredHandler = defineWriteHandler({
  name: "list-unsafe-undeclared",
  schema: listUnsafeUndeclaredSchema,
  access: { roles: ["Admin"] },
  perform: stepsPipeline<z.infer<typeof listUnsafeUndeclaredSchema>, { count: number }>(({ r }) => [
    r.step.read.findMany("items", {
      table: readFilterTable,
      unsafeAllTenants: { reason: UNDECLARED_REASON },
    }),
    r.step.return(({ steps }) => ({
      isSuccess: true as const,
      data: { count: (steps["items"] as readonly unknown[]).length },
    })),
  ]),
});

const listEscapedSchema = z.object({});
const listEscapedHandler = defineWriteHandler({
  name: "list-escaped",
  schema: listEscapedSchema,
  access: { roles: ["Admin"] },
  escapeHatch: { reason: ESCAPED_REASON },
  perform: stepsPipeline<z.infer<typeof listEscapedSchema>, { count: number }>(({ r }) => [
    r.step.read.findMany("items", {
      table: readFilterTable,
      unsafeAllTenants: { reason: ESCAPED_REASON },
    }),
    r.step.return(({ steps }) => ({
      isSuccess: true as const,
      data: { count: (steps["items"] as readonly unknown[]).length },
    })),
  ]),
});

const readStepsTenantFilterFeature = defineFeature("read-steps-tenant-filter", (r) => {
  r.requires.projection("fw2914_read_filter_items");
  r.writeHandler(listHandler);
  r.writeHandler(getHandler);
  r.writeHandler(listUnsafeUndeclaredHandler);
  r.writeHandler(listEscapedHandler);
});

const admin = TestUsers.admin;
const otherTenant = TestUsers.otherTenant;

describe("r.step.read.findOne/findMany tenant-filtering (fw#2914)", () => {
  let stack: TestStack;
  const events: EscapeHatchUseEvent[] = [];
  let adminRowId: string;
  let otherTenantRowId: string;

  beforeAll(async () => {
    stack = await setupTestStack({
      features: [readStepsTenantFilterFeature],
      extraContext: {
        _escapeHatchAuditSink: async (event: EscapeHatchUseEvent) => {
          events.push(event);
        },
      },
    });
    await unsafePushTables(stack.db, { fw2914_read_filter_items: readFilterTable });

    const adminRow = await insertOne<{ id: string }>(stack.db, readFilterTable, {
      tenantId: admin.tenantId,
      label: "admin-row",
    });
    const otherRow = await insertOne<{ id: string }>(stack.db, readFilterTable, {
      tenantId: otherTenant.tenantId,
      label: "other-tenant-row",
    });
    adminRowId = adminRow!.id;
    otherTenantRowId = otherRow!.id;
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("read.findMany returns only the caller's own tenant rows", async () => {
    const data = await stack.http.writeOk<{ count: number; ids: string[] }>(
      "read-steps-tenant-filter:write:list",
      {},
      admin,
    );

    expect(data.count).toBe(1);
    expect(data.ids).toEqual([adminRowId]);
    expect(data.ids).not.toContain(otherTenantRowId);
  });

  test("read.findOne returns the row when it belongs to the caller's tenant", async () => {
    const data = await stack.http.writeOk<{ found: boolean; label: string | null }>(
      "read-steps-tenant-filter:write:get",
      { id: adminRowId },
      admin,
    );

    expect(data).toEqual({ found: true, label: "admin-row" });
  });

  test("read.findOne returns null for a row belonging to a different tenant", async () => {
    const data = await stack.http.writeOk<{ found: boolean; label: string | null }>(
      "read-steps-tenant-filter:write:get",
      { id: otherTenantRowId },
      admin,
    );

    expect(data).toEqual({ found: false, label: null });
  });

  test("unsafeAllTenants without escapeHatch on the handler is denied and reports nothing", async () => {
    events.length = 0;

    const err = await stack.http.writeErr(
      "read-steps-tenant-filter:write:list-unsafe-undeclared",
      {},
      admin,
    );

    expect(err.httpStatus).toBe(403);
    expect(err.code).toBe("access_denied");
    expect(events.filter((e) => e.kind === "unsafe-raw")).toEqual([]);
  });

  test("unsafeAllTenants with escapeHatch on the handler sees rows across tenants and reports unsafe-raw", async () => {
    events.length = 0;

    const data = await stack.http.writeOk<{ count: number }>(
      "read-steps-tenant-filter:write:list-escaped",
      {},
      admin,
    );

    expect(data.count).toBeGreaterThanOrEqual(2);

    const matches = events.filter((e) => e.kind === "unsafe-raw");
    expect(matches).toEqual([
      {
        handler: "read-steps-tenant-filter:write:list-escaped",
        kind: "unsafe-raw",
        reason: ESCAPED_REASON,
        tenantId: admin.tenantId,
        actor: admin.id,
      },
    ]);
  });
});
