// C1/fw#2913 — ctx.queryProjection: read projection tables by qualified name.
// Framework-level read surface so features don't have to import projection
// drizzle-tables directly. Auto-filters by tenant_id when the projection
// table carries that column; { unsafeAllTenants: true } opts out but needs a
// grant — r.systemScope() or a declared escapeHatch on the handler.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  integer as pgInteger,
  table as pgTable,
  text as pgText,
  uuid as pgUuid,
} from "../../db/dialect";
import { defineUnmanagedTable } from "../../db/entity-table-meta";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { insertOne } from "../../db/query";
import { buildEntityTable } from "../../db/table-builder";
import { createEntity, createTextField, defineFeature } from "../../engine";
import type { EscapeHatchUseEvent, ProjectionTable } from "../../engine/types";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "../../stack";

const widgetEntity = createEntity({
  table: "read_qp_widgets",
  fields: { name: createTextField({ personal: false, reason: "test_fixture", required: true }) },
});
const widgetTable = buildEntityTable("qp-widget", widgetEntity);

// Tenant-scoped projection — auto-filter by tenant_id.
const tenantScopedTable = pgTable("read_qp_widget_count_tenant", {
  widgetId: pgUuid("widget_id").primaryKey(),
  tenantId: pgUuid("tenant_id").notNull(),
  label: pgText("label").notNull(),
  count: pgInteger("count").notNull().default(1),
});

// System-scoped projection (no tenant_id column) — every caller sees every row.
const systemScopedTable = pgTable("read_qp_widget_audit", {
  widgetId: pgUuid("widget_id").primaryKey(),
  label: pgText("label").notNull(),
});

// Plain EntityTableMeta table (no SchemaTable symbols) — exercises
// hasTenantColumn's meta-fallback branch instead of the drizzle-symbol path.
const entityMetaWidgetTable = defineUnmanagedTable({
  tableName: "store_qp_widget_meta",
  columns: [
    { name: "widget_id", pgType: "uuid", notNull: true, primaryKey: true },
    { name: "tenant_id", pgType: "uuid", notNull: true },
    { name: "label", pgType: "text", notNull: true },
  ],
});

const UNSAFE_ALL_TENANTS_REASON = "fw#2913 test — cross-tenant widget sweep";

const qpFeature = defineFeature("qp", (r) => {
  r.entity("qp-widget", widgetEntity);

  r.projection({
    name: "widget-count-tenant",
    source: "qp-widget",
    table: tenantScopedTable,
    apply: {
      "qp-widget.created": async (event, tx) => {
        const p = event.payload as { name?: string };
        await insertOne(tx, tenantScopedTable, {
          widgetId: event.aggregateId,
          tenantId: event.tenantId,
          label: p.name ?? "?",
        });
      },
    },
  });

  r.projection({
    name: "widget-audit",
    source: "qp-widget",
    table: systemScopedTable,
    apply: {
      "qp-widget.created": async (event, tx) => {
        const p = event.payload as { name?: string };
        await insertOne(tx, systemScopedTable, {
          widgetId: event.aggregateId,
          label: p.name ?? "?",
        });
      },
    },
  });

  r.projection({
    name: "widget-count-entitymeta",
    source: "qp-widget",
    // @cast-boundary test-fixture — a plain EntityTableMeta lacks SchemaTable's
    // drizzle symbols; asEntityTableMeta()'s fallback branch reads it directly.
    table: entityMetaWidgetTable as unknown as ProjectionTable,
    apply: {
      "qp-widget.created": async (event, tx) => {
        const p = event.payload as { name?: string };
        await insertOne(tx, entityMetaWidgetTable, {
          widgetId: event.aggregateId,
          tenantId: event.tenantId,
          label: p.name ?? "?",
        });
      },
    },
  });

  const executor = createEventStoreExecutor(widgetTable, widgetEntity, {
    entityName: "qp-widget",
  });

  r.writeHandler(
    "widget:create",
    z.object({ name: z.string() }),
    async (event, ctx) => executor.create(event.payload, event.user, ctx.db),
    { access: { roles: ["Admin"] } },
  );

  r.queryHandler(
    "widget:list-tenant",
    z.object({}),
    async (_query, ctx) => ctx.queryProjection("qp:projection:widget-count-tenant"),
    { access: { openToAll: { reason: "test handler callable by any signed-in test user" } } },
  );

  r.queryHandler(
    "widget:list-system",
    z.object({ unsafeAllTenants: z.boolean().optional() }),
    async (query, ctx) =>
      ctx.queryProjection("qp:projection:widget-audit", {
        unsafeAllTenants: query.payload.unsafeAllTenants ?? false,
      }),
    { access: { openToAll: { reason: "test handler callable by any signed-in test user" } } },
  );

  r.queryHandler(
    "widget:list-ghost",
    z.object({}),
    async (_query, ctx) => ctx.queryProjection("qp:projection:does-not-exist"),
    { access: { openToAll: { reason: "test handler callable by any signed-in test user" } } },
  );

  r.queryHandler(
    "widget:list-tenant-escape-hatch",
    z.object({}),
    async (_query, ctx) =>
      ctx.queryProjection("qp:projection:widget-count-tenant", { unsafeAllTenants: true }),
    {
      access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      escapeHatch: { reason: UNSAFE_ALL_TENANTS_REASON },
    },
  );

  r.queryHandler(
    "widget:list-entitymeta",
    z.object({}),
    async (_query, ctx) => ctx.queryProjection("qp:projection:widget-count-entitymeta"),
    { access: { openToAll: { reason: "test handler callable by any signed-in test user" } } },
  );

  r.queryHandler(
    "widget:list-tenant-untyped-payload",
    z.object({ unsafeAllTenants: z.unknown() }),
    async (query, ctx) =>
      ctx.queryProjection("qp:projection:widget-count-tenant", {
        // @cast-boundary test-fixture — deliberately not the literal boolean `true`,
        // proving a truthy-but-not-strictly-true value still tenant-filters.
        unsafeAllTenants: query.payload.unsafeAllTenants as boolean,
      }),
    { access: { openToAll: { reason: "test handler callable by any signed-in test user" } } },
  );
});

const qpSystemFeature = defineFeature("qp-system", (r) => {
  r.systemScope();

  r.queryHandler(
    "widget:list-tenant-systemscope",
    z.object({}),
    async (_query, ctx) =>
      ctx.queryProjection("qp:projection:widget-count-tenant", { unsafeAllTenants: true }),
    { access: { openToAll: { reason: "test handler callable by any signed-in test user" } } },
  );
});

let stack: TestStack;
const admin = TestUsers.admin;
const otherTenantAdmin = {
  ...admin,
  tenantId: "00000000-0000-4000-8000-0000000000b0" as const,
};

function errorReason(details: unknown): string | undefined {
  if (!details || typeof details !== "object" || !("reason" in details)) return undefined;
  return typeof details.reason === "string" ? details.reason : undefined;
}

function recordingSink(events: EscapeHatchUseEvent[]) {
  return async (event: EscapeHatchUseEvent) => {
    events.push(event);
  };
}

const escapeHatchEvents: EscapeHatchUseEvent[] = [];

beforeAll(async () => {
  stack = await setupTestStack({
    features: [qpFeature, qpSystemFeature],
    systemHooks: [],
    extraContext: { _escapeHatchAuditSink: recordingSink(escapeHatchEvents) },
  });
  await unsafeCreateEntityTable(stack.db, widgetEntity, "qp-widget");
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  escapeHatchEvents.length = 0;
  await resetEventStore(stack, [
    "read_qp_widgets",
    "read_qp_widget_count_tenant",
    "read_qp_widget_audit",
    "store_qp_widget_meta",
  ]);
});

describe("ctx.queryProjection", () => {
  test("auto-filters by tenant_id on tenant-scoped projection", async () => {
    await stack.http.writeOk("qp:write:widget:create", { name: "A-widget" }, admin);
    await stack.http.writeOk("qp:write:widget:create", { name: "B-widget" }, otherTenantAdmin);

    const forAdmin = await stack.http.queryOk<Array<{ label: string; tenantId: string }>>(
      "qp:query:widget:list-tenant",
      {},
      admin,
    );
    expect(forAdmin).toHaveLength(1);
    expect(forAdmin[0]?.label).toBe("A-widget");
    expect(forAdmin[0]?.tenantId).toBe(admin.tenantId);

    const forOther = await stack.http.queryOk<Array<{ label: string }>>(
      "qp:query:widget:list-tenant",
      {},
      otherTenantAdmin,
    );
    expect(forOther).toHaveLength(1);
    expect(forOther[0]?.label).toBe("B-widget");
  });

  test("projection without tenant_id column returns all rows", async () => {
    await stack.http.writeOk("qp:write:widget:create", { name: "X" }, admin);
    await stack.http.writeOk("qp:write:widget:create", { name: "Y" }, otherTenantAdmin);

    const rows = await stack.http.queryOk<Array<{ label: string }>>(
      "qp:query:widget:list-system",
      {},
      admin,
    );
    // No tenant_id column → auto-filter is a no-op and both rows come back.
    expect(rows.map((r) => r.label).sort()).toEqual(["X", "Y"]);
  });

  test("unsafeAllTenants=true without a grant is denied — no cross-tenant read", async () => {
    await stack.http.writeOk("qp:write:widget:create", { name: "AA" }, admin);
    await stack.http.writeOk("qp:write:widget:create", { name: "BB" }, otherTenantAdmin);

    const err = await stack.http.queryErr(
      "qp:query:widget:list-system",
      { unsafeAllTenants: true },
      admin,
    );
    expect(err.httpStatus).toBe(403);
    expect(err.code).toBe("access_denied");
    expect(errorReason(err.details)).toBe("unsafe_all_tenants_denied");
  });

  test("unknown projection name throws with a helpful error", async () => {
    const res = await stack.http.query("qp:query:widget:list-ghost", {}, admin);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: { message?: string } };
    expect(body.error?.message).toMatch(/projection not registered|does-not-exist/);
  });

  test("escapeHatch grant lets unsafeAllTenants=true read cross-tenant, reporting exactly one unsafe-all-tenants event", async () => {
    await stack.http.writeOk("qp:write:widget:create", { name: "AA" }, admin);
    await stack.http.writeOk("qp:write:widget:create", { name: "BB" }, otherTenantAdmin);

    const rows = await stack.http.queryOk<Array<{ label: string }>>(
      "qp:query:widget:list-tenant-escape-hatch",
      {},
      admin,
    );
    expect(rows.map((r) => r.label).sort()).toEqual(["AA", "BB"]);

    const matches = escapeHatchEvents.filter((e) => e.kind === "unsafe-all-tenants");
    expect(matches).toEqual([
      {
        handler: "qp:query:widget:list-tenant-escape-hatch",
        kind: "unsafe-all-tenants",
        reason: UNSAFE_ALL_TENANTS_REASON,
        tenantId: admin.tenantId,
        actor: admin.id,
      },
    ]);
  });

  test("r.systemScope() grants unsafeAllTenants=true without a declared escapeHatch", async () => {
    await stack.http.writeOk("qp:write:widget:create", { name: "CC" }, admin);
    await stack.http.writeOk("qp:write:widget:create", { name: "DD" }, otherTenantAdmin);

    const rows = await stack.http.queryOk<Array<{ label: string }>>(
      "qp-system:query:widget:list-tenant-systemscope",
      {},
      admin,
    );
    expect(rows.map((r) => r.label).sort()).toEqual(["CC", "DD"]);
  });

  test("a plain EntityTableMeta projection table is tenant-filtered without unsafeAllTenants", async () => {
    await stack.http.writeOk("qp:write:widget:create", { name: "EE" }, admin);
    await stack.http.writeOk("qp:write:widget:create", { name: "FF" }, otherTenantAdmin);

    const forAdmin = await stack.http.queryOk<Array<{ label: string }>>(
      "qp:query:widget:list-entitymeta",
      {},
      admin,
    );
    expect(forAdmin.map((r) => r.label)).toEqual(["EE"]);

    const forOther = await stack.http.queryOk<Array<{ label: string }>>(
      "qp:query:widget:list-entitymeta",
      {},
      otherTenantAdmin,
    );
    expect(forOther.map((r) => r.label)).toEqual(["FF"]);
  });

  test("a truthy-but-not-true unsafeAllTenants payload still tenant-filters (no bypass, no grant)", async () => {
    await stack.http.writeOk("qp:write:widget:create", { name: "GG" }, admin);
    await stack.http.writeOk("qp:write:widget:create", { name: "HH" }, otherTenantAdmin);

    const rows = await stack.http.queryOk<Array<{ label: string }>>(
      "qp:query:widget:list-tenant-untyped-payload",
      { unsafeAllTenants: "yes" },
      admin,
    );
    expect(rows.map((r) => r.label)).toEqual(["GG"]);
  });
});
