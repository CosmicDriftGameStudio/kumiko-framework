// fw#3198 — a postSave hook's OWN `escapeHatch` must gate ctx.systemDb.unsafeRaw
// inside a r.systemScope() handler's write, not the handler's (absent) grant.
// Real HTTP calls + setupTestStack — never createTestDispatcher. Modelled on
// entity-write-crosstenant.integration.test.ts (tier-engine's
// ctx.systemDb.unsafeRaw + createTenantDb(raw, otherTenantId, "system") pattern)
// and escape-hatch-audit.integration.test.ts (recordingSink for EscapeHatchUseEvent).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineUnmanagedTable } from "../../db/entity-table-meta";
import { selectMany } from "../../db/query";
import { createTenantDb } from "../../db/tenant-db";
import {
  createEntity,
  createTextField,
  defineEntityCreateHandler,
  defineFeature,
  HookPhases,
} from "../../engine";
import type { EscapeHatchUseEvent } from "../../engine/types";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
} from "../../stack";

const OTHER_TENANT_ID = testTenantId(2);
const HOOK_ESCAPE_HATCH_REASON = "fw#3198 integration test — hook's own cross-tenant audit write";
const NO_HOOK_ESCAPE_HATCH_REASON = "fw#3198 integration test — hook declared no escapeHatch";

const auditTable = defineUnmanagedTable({
  tableName: "store_fw3198_hook_systemdb_audit",
  columns: [
    {
      name: "id",
      pgType: "uuid",
      notNull: true,
      primaryKey: true,
      defaultSql: "gen_random_uuid()",
    },
    { name: "tenant_id", pgType: "uuid", notNull: true },
    { name: "note", pgType: "text", notNull: true },
  ],
});

type ThingMode =
  | "escapeHatch-unsafe-raw"
  | "escapeHatch-ack-unsafe-raw"
  | "no-escapeHatch-unsafe-raw"
  | "no-escapeHatch-ack-unsafe-raw"
  | "no-escapeHatch-ack-crud";

const thingEntity = createEntity({
  table: "hooksys3198_things",
  fields: {
    label: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    mode: createTextField({ required: true, personal: false, reason: "test_fixture" }),
  },
  access: { write: { Admin: "all" } },
});

// Feature A: r.systemScope() handler whose postSave fires with ctx.systemDb present —
// mirrors tenant/feature.ts (r.systemScope() + entity + create handler).
const featureA = defineFeature("hooksys3198-a", (r) => {
  r.systemScope();
  r.entity("thing", thingEntity);
  r.writeHandler(defineEntityCreateHandler("thing", thingEntity, { access: { roles: ["Admin"] } }));
});

function modeOf(result: unknown): ThingMode | undefined {
  const saveResult = result as { isNew?: unknown; data?: unknown };
  if (saveResult.isNew !== true) return undefined;
  const data = saveResult.data as { mode?: unknown };
  return typeof data.mode === "string" ? (data.mode as ThingMode) : undefined;
}

function labelOf(result: unknown): string {
  const saveResult = result as { data?: unknown };
  const data = saveResult.data as { label?: unknown };
  return typeof data.label === "string" ? data.label : "";
}

// Feature B: NOT systemScope, hooks cross-feature onto A's "thing" entity — same
// shape as tier-engine's hook on the "tenant" feature's entity.
const featureB = defineFeature("hooksys3198-b", (r) => {
  r.storeTable(auditTable, {
    reason:
      "fw#3198 integration test — cross-tenant audit row written from a hook's own escapeHatch",
  });

  r.hook(
    "postSave",
    { allOf: "thing" },
    async (result, ctx) => {
      const mode = modeOf(result);
      if (mode !== "escapeHatch-unsafe-raw" && mode !== "escapeHatch-ack-unsafe-raw") return;
      if (!ctx.systemDb) return;
      const rawDb =
        mode === "escapeHatch-unsafe-raw"
          ? ctx.systemDb.unsafeRaw(HOOK_ESCAPE_HATCH_REASON)
          : ctx.systemDb
              .acknowledgeCrossTenant(HOOK_ESCAPE_HATCH_REASON)
              .unsafeRaw(HOOK_ESCAPE_HATCH_REASON);
      const otherTenantDb = createTenantDb(rawDb, OTHER_TENANT_ID, "system");
      await otherTenantDb.insertOne(auditTable, { note: `${mode}:${labelOf(result)}` });
    },
    { escapeHatch: { reason: HOOK_ESCAPE_HATCH_REASON } },
    // phase defaults to afterCommit
  );

  r.hook(
    "postSave",
    { allOf: "thing" },
    async (result, ctx) => {
      const mode = modeOf(result);
      if (!ctx.systemDb) return;
      if (mode === "no-escapeHatch-unsafe-raw") {
        const rawDb = ctx.systemDb.unsafeRaw(NO_HOOK_ESCAPE_HATCH_REASON);
        const otherTenantDb = createTenantDb(rawDb, OTHER_TENANT_ID, "system");
        await otherTenantDb.insertOne(auditTable, { note: `${mode}:${labelOf(result)}` });
      } else if (mode === "no-escapeHatch-ack-unsafe-raw") {
        const rawDb = ctx.systemDb
          .acknowledgeCrossTenant(NO_HOOK_ESCAPE_HATCH_REASON)
          .unsafeRaw(NO_HOOK_ESCAPE_HATCH_REASON);
        const otherTenantDb = createTenantDb(rawDb, OTHER_TENANT_ID, "system");
        await otherTenantDb.insertOne(auditTable, { note: `${mode}:${labelOf(result)}` });
      } else if (mode === "no-escapeHatch-ack-crud") {
        const db = ctx.systemDb.acknowledgeCrossTenant(NO_HOOK_ESCAPE_HATCH_REASON);
        await db.insertOne(auditTable, {
          tenantId: OTHER_TENANT_ID,
          note: `${mode}:${labelOf(result)}`,
        });
      }
    },
    { phase: HookPhases.inTransaction },
  );
});

function recordingSink(events: EscapeHatchUseEvent[]) {
  return async (event: EscapeHatchUseEvent) => {
    events.push(event);
  };
}

async function auditNotesFor(
  label: string,
): Promise<ReadonlyArray<{ tenantId: string; note: string }>> {
  const rows = await selectMany<{ tenantId: string; note: string }>(stack.db, auditTable, {});
  return rows.filter((r) => r.note.endsWith(`:${label}`));
}

let stack: TestStack;
const escapeHatchAuditEvents: EscapeHatchUseEvent[] = [];

beforeAll(async () => {
  stack = await setupTestStack({
    features: [featureA, featureB],
    extraContext: { _escapeHatchAuditSink: recordingSink(escapeHatchAuditEvents) },
  });
  await unsafeCreateEntityTable(stack.db, thingEntity, "thing");
});

afterAll(async () => {
  await stack.cleanup();
});

describe("a postSave hook's own escapeHatch gates ctx.systemDb.unsafeRaw (fw#3198)", () => {
  test("afterCommit, WITH escapeHatch, ctx.systemDb.unsafeRaw: cross-tenant audit row lands, reported as unsafe-raw", async () => {
    escapeHatchAuditEvents.length = 0;
    const label = `label-${crypto.randomUUID()}`;
    await stack.http.writeOk(
      "hooksys3198-a:write:thing:create",
      { label, mode: "escapeHatch-unsafe-raw" },
      TestUsers.admin,
    );

    const rows = await auditNotesFor(label);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenantId).toBe(OTHER_TENANT_ID);

    const matches = escapeHatchAuditEvents.filter((e) => e.kind === "unsafe-raw");
    expect(matches).toEqual([
      {
        handler: "hooksys3198-a:write:thing:create",
        kind: "unsafe-raw",
        reason: HOOK_ESCAPE_HATCH_REASON,
        tenantId: TestUsers.admin.tenantId,
        actor: TestUsers.admin.id,
        target: undefined,
      },
    ]);
  });

  test("afterCommit, WITH escapeHatch, ctx.systemDb.acknowledgeCrossTenant(...).unsafeRaw: cross-tenant audit row lands (the reported issue path)", async () => {
    const label = `label-${crypto.randomUUID()}`;
    await stack.http.writeOk(
      "hooksys3198-a:write:thing:create",
      { label, mode: "escapeHatch-ack-unsafe-raw" },
      TestUsers.admin,
    );

    const rows = await auditNotesFor(label);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenantId).toBe(OTHER_TENANT_ID);
  });

  test("inTransaction, WITHOUT escapeHatch, ctx.systemDb.unsafeRaw: denied, no audit row", async () => {
    const label = `label-${crypto.randomUUID()}`;
    const err = await stack.http.writeErr(
      "hooksys3198-a:write:thing:create",
      { label, mode: "no-escapeHatch-unsafe-raw" },
      TestUsers.admin,
    );
    expect(err.code).toBe("access_denied");

    const rows = await auditNotesFor(label);
    expect(rows).toHaveLength(0);
  });

  test("inTransaction, WITHOUT escapeHatch, ctx.systemDb.acknowledgeCrossTenant(...).unsafeRaw: denied, no audit row", async () => {
    const label = `label-${crypto.randomUUID()}`;
    const err = await stack.http.writeErr(
      "hooksys3198-a:write:thing:create",
      { label, mode: "no-escapeHatch-ack-unsafe-raw" },
      TestUsers.admin,
    );
    expect(err.code).toBe("access_denied");

    const rows = await auditNotesFor(label);
    expect(rows).toHaveLength(0);
  });

  test("inTransaction, WITHOUT escapeHatch, ctx.systemDb.acknowledgeCrossTenant(...) typed CRUD: still works (regression)", async () => {
    const label = `label-${crypto.randomUUID()}`;
    await stack.http.writeOk(
      "hooksys3198-a:write:thing:create",
      { label, mode: "no-escapeHatch-ack-crud" },
      TestUsers.admin,
    );

    const rows = await auditNotesFor(label);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenantId).toBe(OTHER_TENANT_ID);
  });
});
