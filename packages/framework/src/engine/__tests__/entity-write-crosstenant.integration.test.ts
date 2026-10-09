// fw#2650/fw#2915 — escapeHatch on entity convention handlers. A
// SystemAdmin operator reads/writes a row that lives in a different tenant
// than their own session. That needs two things: (1) an unfiltered db
// instead of the caller's tenant-scoped one (so the row is even visible),
// and (2) the event-store stream AND the entity's tenant-based
// write-ownership rule — both keyed off the ACTING user, not the db — so the
// acting user's tenantId must be rewritten to the target row's tenant before
// the write, not just handed an unfiltered db.
//
// Two stacks on the SAME Postgres database: "none" (no cross-tenant
// option) and "escapeHatch" (`escapeHatch: { reason }`) — a clean A/B on the
// one option, no handler-name collisions to work around.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { EscapeHatchUseEvent } from "@cosmicdrift/kumiko-types/handlers";
import { selectMany } from "../../db/query.js";
import { buildEntityTable } from "../../db/table-builder.js";
import { eventsTable } from "../../event-store/index.js";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
} from "../../stack/index.js";
import {
  createEntity,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDeleteHandler,
  defineEntityListHandler,
  defineEntityRestoreHandler,
  defineEntityUpdateHandler,
  defineFeature,
  from,
} from "../index.js";
import { SYSTEM_TENANT_ID } from "../types/identifiers.js";

// "Admin" passes unconditionally (any tenant may create its own rows).
// "SystemAdmin" is tenant-scoped — this is the entity-level rule the
// escapeHatch acting-user rewrite must satisfy for the operator
// write to go through; without the rewrite the acting user's own tenant
// would never match a foreign row's tenantId here.
const thingEntity = createEntity({
  table: "ctwrite_things",
  fields: {
    label: createTextField({ required: true, personal: false, reason: "test_fixture" }),
  },
  softDelete: true,
  access: { write: { Admin: "all", SystemAdmin: from("user:tenantId", "tenantId") } },
});
const thingTable = buildEntityTable("thing", thingEntity);

// systemStream entity: its stream lives on SYSTEM_TENANT_ID, so the acting
// tenant must NOT be rewritten to a row tenant.
const globalThingEntity = createEntity({
  table: "ctwrite_global_things",
  tenancy: "global",
  systemStream: true,
  fields: {
    label: createTextField({ required: true, personal: false, reason: "test_fixture" }),
  },
  access: { write: { Admin: "all", SystemAdmin: "all" } },
});

const ESCAPE_HATCH_REASON = "fw#2915 integration test — operator cross-tenant scan";

type CrossTenantMode = "none" | "escapeHatch";

function crossTenantOptionsFor(mode: CrossTenantMode) {
  switch (mode) {
    case "escapeHatch":
      return { escapeHatch: { reason: ESCAPE_HATCH_REASON } };
    case "none":
      return {};
  }
}

function buildFeature(mode: CrossTenantMode) {
  return defineFeature("ctwrite", (r) => {
    r.entity("thing", thingEntity);
    r.writeHandler(
      // create always writes into the acting tenant, so it never carries the cross-tenant option
      defineEntityCreateHandler("thing", thingEntity, {
        access: { roles: ["Admin", "SystemAdmin"] },
      }),
    );
    r.writeHandler(
      defineEntityUpdateHandler("thing", thingEntity, {
        access: { roles: ["SystemAdmin"] },
        ...crossTenantOptionsFor(mode),
      }),
    );
    r.writeHandler(
      defineEntityDeleteHandler("thing", thingEntity, {
        access: { roles: ["SystemAdmin"] },
        ...crossTenantOptionsFor(mode),
      }),
    );
    r.writeHandler(
      defineEntityRestoreHandler("thing", thingEntity, {
        access: { roles: ["SystemAdmin"] },
        ...crossTenantOptionsFor(mode),
      }),
    );
    r.entity("globalthing", globalThingEntity);
    r.writeHandler(
      defineEntityCreateHandler("globalthing", globalThingEntity, {
        access: { roles: ["Admin", "SystemAdmin"] },
      }),
    );
    r.writeHandler(
      defineEntityUpdateHandler("globalthing", globalThingEntity, {
        access: { roles: ["SystemAdmin"] },
        ...crossTenantOptionsFor(mode),
      }),
    );
    r.queryHandler(
      defineEntityListHandler("thing", thingEntity, {
        access: { roles: ["SystemAdmin"] },
        ...crossTenantOptionsFor(mode),
      }),
    );
  });
}

const dbName = `kumiko_test_ctwrite_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;

function recordingSink(events: EscapeHatchUseEvent[]) {
  return async (event: EscapeHatchUseEvent) => {
    events.push(event);
  };
}

let noneStack: TestStack;
let escapeHatchStack: TestStack;

const escapeHatchAuditEvents: EscapeHatchUseEvent[] = [];

beforeAll(async () => {
  noneStack = await setupTestStack({ features: [buildFeature("none")], dbName });
  await unsafeCreateEntityTable(noneStack.db, thingEntity, "thing");
  await unsafeCreateEntityTable(noneStack.db, globalThingEntity, "globalthing");
  // Second and third connections to the SAME database — persistentDb:true
  // means their cleanup() only closes the pool; noneStack (created without
  // that flag) owns the actual DROP DATABASE and must clean up last.
  escapeHatchStack = await setupTestStack({
    features: [buildFeature("escapeHatch")],
    dbName,
    persistentDb: true,
    extraContext: { _escapeHatchAuditSink: recordingSink(escapeHatchAuditEvents) },
  });
});

afterAll(async () => {
  await escapeHatchStack.cleanup();
  await noneStack.cleanup();
});

async function eventTenantId(aggregateId: string, verb: string): Promise<string | undefined> {
  const rows = await selectMany<{ type: string; tenantId: string }>(noneStack.db, eventsTable, {
    aggregateId,
  });
  return rows.find((r) => r.type.includes(verb))?.tenantId;
}

const updatedEventTenantId = (aggregateId: string) => eventTenantId(aggregateId, "updated");

describe("entity write/list handlers: none vs. escapeHatch (fw#2650/fw#2915)", () => {
  test("escapeHatch handler: SystemAdmin updates a row owned by another tenant, reported as acknowledge-cross-tenant", async () => {
    escapeHatchAuditEvents.length = 0;
    const created = await noneStack.http.writeOk<{ id: string }>(
      "ctwrite:write:thing:create",
      { label: "foreign-escape-hatch" },
      TestUsers.otherTenant,
    );

    const updated = await escapeHatchStack.http.writeOk<{ id: string; data: { label: string } }>(
      "ctwrite:write:thing:update",
      { id: created.id, version: 1, changes: { label: "touched by operator via escapeHatch" } },
      TestUsers.systemAdmin,
    );
    expect(updated.data.label).toBe("touched by operator via escapeHatch");

    const rows = await selectMany(noneStack.db, thingTable, { id: created.id });
    expect(rows[0]?.["tenantId"]).toBe(testTenantId(2));
    expect(await updatedEventTenantId(created.id)).toBe(testTenantId(2));

    const matches = escapeHatchAuditEvents.filter((e) => e.kind === "acknowledge-cross-tenant");
    expect(matches).toEqual([
      {
        handler: "ctwrite:write:thing:update",
        kind: "acknowledge-cross-tenant",
        reason: ESCAPE_HATCH_REASON,
        tenantId: TestUsers.systemAdmin.tenantId,
        actor: TestUsers.systemAdmin.id,
        target: { id: created.id, tenantId: testTenantId(2) },
      },
    ]);
  });

  test("escapeHatch: SystemAdmin soft-deletes and restores a foreign row, both events land on the row's tenant stream", async () => {
    const created = await noneStack.http.writeOk<{ id: string }>(
      "ctwrite:write:thing:create",
      { label: "foreign-delete-restore" },
      TestUsers.otherTenant,
    );

    await escapeHatchStack.http.writeOk(
      "ctwrite:write:thing:delete",
      { id: created.id },
      TestUsers.systemAdmin,
    );
    expect(await eventTenantId(created.id, "deleted")).toBe(testTenantId(2));

    await escapeHatchStack.http.writeOk(
      "ctwrite:write:thing:restore",
      { id: created.id },
      TestUsers.systemAdmin,
    );
    expect(await eventTenantId(created.id, "restored")).toBe(testTenantId(2));
  });

  test("systemStream entity: the stream stays on the system tenant, the acting tenant is not rewritten", async () => {
    const created = await noneStack.http.writeOk<{ id: string }>(
      "ctwrite:write:globalthing:create",
      { label: "global" },
      TestUsers.admin,
    );
    await escapeHatchStack.http.writeOk(
      "ctwrite:write:globalthing:update",
      { id: created.id, version: 1, changes: { label: "global touched" } },
      TestUsers.systemAdmin,
    );
    expect(await eventTenantId(created.id, "updated")).toBe(SYSTEM_TENANT_ID);
  });

  test("escapeHatch list: SystemAdmin sees rows from every tenant, reported as acknowledge-cross-tenant", async () => {
    escapeHatchAuditEvents.length = 0;
    await noneStack.http.writeOk(
      "ctwrite:write:thing:create",
      { label: "own-tenant-row" },
      TestUsers.admin,
    );
    await noneStack.http.writeOk(
      "ctwrite:write:thing:create",
      { label: "other-tenant-row" },
      TestUsers.otherTenant,
    );

    const list = await escapeHatchStack.http.queryOk<{
      rows: ReadonlyArray<{ tenantId: string }>;
    }>("ctwrite:query:thing:list", {}, TestUsers.systemAdmin);
    const tenantIds = new Set(list.rows.map((r) => r.tenantId));
    expect(tenantIds.has(testTenantId(1))).toBe(true);
    expect(tenantIds.has(testTenantId(2))).toBe(true);

    const matches = escapeHatchAuditEvents.filter((e) => e.kind === "acknowledge-cross-tenant");
    expect(matches).toEqual([
      {
        handler: "ctwrite:query:thing:list",
        kind: "acknowledge-cross-tenant",
        reason: ESCAPE_HATCH_REASON,
        tenantId: TestUsers.systemAdmin.tenantId,
        actor: TestUsers.systemAdmin.id,
      },
    ]);
  });

  test("none: list returns only the caller's own tenant rows", async () => {
    const created = await noneStack.http.writeOk<{ id: string }>(
      "ctwrite:write:thing:create",
      { label: "none-mode-own-tenant" },
      TestUsers.admin,
    );

    const list = await noneStack.http.queryOk<{
      rows: ReadonlyArray<{ id: string; tenantId: string }>;
    }>("ctwrite:query:thing:list", {}, TestUsers.systemAdmin);
    expect(list.rows.some((r) => r.id === created.id)).toBe(true);
    expect(list.rows.every((r) => r.tenantId === testTenantId(1))).toBe(true);
  });

  test("normal (no escapeHatch) handler cannot reach a row in another tenant", async () => {
    const created = await noneStack.http.writeOk<{ id: string }>(
      "ctwrite:write:thing:create",
      { label: "foreign-untouched" },
      TestUsers.otherTenant,
    );

    const err = await noneStack.http.writeErr(
      "ctwrite:write:thing:update",
      { id: created.id, version: 1, changes: { label: "nope" } },
      TestUsers.systemAdmin,
    );
    expect(err.code).toBe("not_found");

    const rows = await selectMany(noneStack.db, thingTable, { id: created.id });
    expect(rows[0]?.["label"]).toBe("foreign-untouched");
  });

  test("escapeHatch still gates on access — a role without SystemAdmin is denied", async () => {
    const createdEscapeHatch = await noneStack.http.writeOk<{ id: string }>(
      "ctwrite:write:thing:create",
      { label: "foreign-denied-escape-hatch" },
      TestUsers.otherTenant,
    );
    const errEscapeHatch = await escapeHatchStack.http.writeErr(
      "ctwrite:write:thing:update",
      { id: createdEscapeHatch.id, version: 1, changes: { label: "nope" } },
      TestUsers.admin,
    );
    expect(errEscapeHatch.code).toBe("access_denied");
  });
});
