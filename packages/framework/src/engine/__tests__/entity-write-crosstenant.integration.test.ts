// fw#2650/fw#2915 — crossTenant / escapeHatch on entity convention handlers. A
// SystemAdmin operator reads/writes a row that lives in a different tenant
// than their own session. That needs two things: (1) an unfiltered db
// instead of the caller's tenant-scoped one (so the row is even visible),
// and (2) the event-store stream AND the entity's tenant-based
// write-ownership rule — both keyed off the ACTING user, not the db — so the
// acting user's tenantId must be rewritten to the target row's tenant before
// the write, not just handed an unfiltered db.
//
// Three stacks on the SAME Postgres database: "none" (no cross-tenant
// option), "legacy" (`crossTenant: true`), "escapeHatch"
// (`escapeHatch: { reason }`) — a clean A/B/C on the one option, no
// handler-name collisions to work around.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { EscapeHatchUseEvent } from "@cosmicdrift/kumiko-types/handlers";
import { selectMany } from "../../db/query";
import { buildEntityTable } from "../../db/table-builder";
import { eventsTable } from "../../event-store";
import type { Logger } from "../../logging/types";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
} from "../../stack";
import { DEPRECATED_CROSS_TENANT_SIGNAL } from "../entity-handlers";
import {
  createEntity,
  createTextField,
  defineEntityCreateHandler,
  defineEntityListHandler,
  defineEntityUpdateHandler,
  defineFeature,
  from,
} from "../index";

// "Admin" passes unconditionally (any tenant may create its own rows).
// "SystemAdmin" is tenant-scoped — this is the entity-level rule the
// crossTenant/escapeHatch acting-user rewrite must satisfy for the operator
// write to go through; without the rewrite the acting user's own tenant
// would never match a foreign row's tenantId here.
const thingEntity = createEntity({
  table: "ctwrite_things",
  fields: {
    label: createTextField({ required: true, personal: false, reason: "test_fixture" }),
  },
  access: { write: { Admin: "all", SystemAdmin: from("user:tenantId", "tenantId") } },
});
const thingTable = buildEntityTable("thing", thingEntity);

const ESCAPE_HATCH_REASON = "fw#2915 integration test — operator cross-tenant scan";

type CrossTenantMode = "none" | "legacy" | "escapeHatch";

function crossTenantOptionsFor(mode: CrossTenantMode) {
  switch (mode) {
    case "legacy":
      return { crossTenant: true as const };
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

function recordingLogger(sink: Array<{ msg: string; data?: Record<string, unknown> }>): Logger {
  const log: Logger = {
    info() {},
    debug() {},
    warn(msg, data) {
      sink.push({ msg, data });
    },
    error() {},
    child() {
      return log;
    },
  };
  return log;
}

let noneStack: TestStack;
let legacyStack: TestStack;
let escapeHatchStack: TestStack;

const legacyWarnCalls: Array<{ msg: string; data?: Record<string, unknown> }> = [];
const escapeHatchWarnCalls: Array<{ msg: string; data?: Record<string, unknown> }> = [];
const escapeHatchAuditEvents: EscapeHatchUseEvent[] = [];

beforeAll(async () => {
  noneStack = await setupTestStack({ features: [buildFeature("none")], dbName });
  await unsafeCreateEntityTable(noneStack.db, thingEntity, "thing");
  // Second and third connections to the SAME database — persistentDb:true
  // means their cleanup() only closes the pool; noneStack (created without
  // that flag) owns the actual DROP DATABASE and must clean up last.
  legacyStack = await setupTestStack({
    features: [buildFeature("legacy")],
    dbName,
    persistentDb: true,
    extraContext: { log: recordingLogger(legacyWarnCalls) },
  });
  escapeHatchStack = await setupTestStack({
    features: [buildFeature("escapeHatch")],
    dbName,
    persistentDb: true,
    extraContext: {
      _escapeHatchAuditSink: recordingSink(escapeHatchAuditEvents),
      log: recordingLogger(escapeHatchWarnCalls),
    },
  });
});

afterAll(async () => {
  await escapeHatchStack.cleanup();
  await legacyStack.cleanup();
  await noneStack.cleanup();
});

async function updatedEventTenantId(aggregateId: string): Promise<string | undefined> {
  const rows = await selectMany<{ type: string; tenantId: string }>(noneStack.db, eventsTable, {
    aggregateId,
  });
  const updatedRow = rows.find((r) => r.type.includes("updated"));
  return updatedRow?.tenantId;
}

describe("entity write/list handlers: crossTenant vs. escapeHatch (fw#2650/fw#2915)", () => {
  test("legacy crossTenant handler: SystemAdmin updates a row owned by another tenant", async () => {
    const created = await noneStack.http.writeOk<{ id: string }>(
      "ctwrite:write:thing:create",
      { label: "foreign" },
      TestUsers.otherTenant,
    );

    const updated = await legacyStack.http.writeOk<{ id: string; data: { label: string } }>(
      "ctwrite:write:thing:update",
      { id: created.id, version: 1, changes: { label: "touched by operator" } },
      TestUsers.systemAdmin,
    );
    expect(updated.data.label).toBe("touched by operator");

    // Row stays on its original tenant — crossTenant reaches across the
    // tenant boundary, it does not migrate the row.
    const rows = await selectMany(noneStack.db, thingTable, { id: created.id });
    expect(rows[0]?.["tenantId"]).toBe(testTenantId(2));

    // The append must land on the row's own tenant stream, not the acting
    // (operator) user's — otherwise the append targets an empty stream in
    // the operator's tenant and the update would have failed above with a
    // bogus version_conflict rather than reaching this point at all.
    expect(await updatedEventTenantId(created.id)).toBe(testTenantId(2));
  });

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
      },
    ]);
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

  test("normal (non-crossTenant) handler cannot reach a row in another tenant", async () => {
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

  test("crossTenant/escapeHatch still gate on access — a role without SystemAdmin is denied", async () => {
    const createdLegacy = await noneStack.http.writeOk<{ id: string }>(
      "ctwrite:write:thing:create",
      { label: "foreign-denied-legacy" },
      TestUsers.otherTenant,
    );
    const errLegacy = await legacyStack.http.writeErr(
      "ctwrite:write:thing:update",
      { id: createdLegacy.id, version: 1, changes: { label: "nope" } },
      TestUsers.admin,
    );
    expect(errLegacy.code).toBe("access_denied");

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

  test("legacy stack warns once per deprecated crossTenant handler at boot; the escapeHatch stack does not", () => {
    const legacyMatches = legacyWarnCalls.filter((c) => c.msg === DEPRECATED_CROSS_TENANT_SIGNAL);
    const legacyHandlers = legacyMatches.map((c) => c.data?.["handler"]).sort();
    expect(legacyHandlers).toEqual(["ctwrite:query:thing:list", "ctwrite:write:thing:update"]);

    const escapeHatchMatches = escapeHatchWarnCalls.filter(
      (c) => c.msg === DEPRECATED_CROSS_TENANT_SIGNAL,
    );
    expect(escapeHatchMatches).toEqual([]);
  });
});
