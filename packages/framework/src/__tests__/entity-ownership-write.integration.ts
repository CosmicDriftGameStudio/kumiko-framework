// Entity-level write-ownership: user can only create/update/delete rows
// their role+claims grant access to. Covers the full attack surface:
//  - row-grabbing via foreign-id updates
//  - row-grabbing via teamId-column-rewrite
//  - Straddle attack (multi-role splits old vs. new row check)
//  - delete on foreign row
//  - restore on foreign row

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import {
  createEntity,
  createTextField,
  defineEntityQueryHandler,
  defineEntityWriteHandler,
  defineFeature,
  from,
} from "../engine";
import {
  createEntityTable,
  createTestUser,
  expectErrorIncludes,
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
} from "../testing";

// Entity with read AND write ownership. Manager = team-scoped, Driver =
// assigned-to-me-scoped, Admin = all. Guest intentionally not in either map.
const orderEntity = createEntity({
  table: "h2w_orders",
  idType: "uuid",
  softDelete: true,
  fields: {
    teamId: createTextField({ required: true }),
    assigneeId: createTextField(),
    title: createTextField({ required: true }),
  },
  access: {
    read: {
      Admin: "all",
      Manager: from("claim:teams:teamId"),
      Driver: from("user:id", "assigneeId"),
    },
    write: {
      Admin: "all",
      Manager: from("claim:teams:teamId"),
      Driver: from("user:id", "assigneeId"),
    },
  },
});

const ordersFeature = defineFeature("worders", (r) => {
  r.entity("order", orderEntity);
  r.writeHandler(
    defineEntityWriteHandler("order:create", orderEntity, {
      access: { roles: ["Admin", "Manager", "Driver", "Guest"] },
    }),
  );
  r.writeHandler(
    defineEntityWriteHandler("order:update", orderEntity, {
      access: { roles: ["Admin", "Manager", "Driver", "Guest"] },
    }),
  );
  r.writeHandler(
    defineEntityWriteHandler("order:delete", orderEntity, {
      access: { roles: ["Admin", "Manager", "Driver", "Guest"] },
    }),
  );
  r.writeHandler(
    defineEntityWriteHandler("order:restore", orderEntity, {
      access: { roles: ["Admin", "Manager", "Driver", "Guest"] },
    }),
  );
  r.queryHandler(
    defineEntityQueryHandler("order:detail", orderEntity, {
      access: { roles: ["Admin", "Manager", "Driver", "Guest"] },
    }),
  );
});

const teamsFeature = defineFeature("teams", (r) => {
  r.claimKey("teamId", { type: "string" });
});

let stack: TestStack;
const tenant = testTenantId(1);

const admin = { ...TestUsers.admin, tenantId: tenant };
const managerEng = createTestUser({
  id: "22222222-0000-4000-8000-000000000001",
  tenantId: tenant,
  roles: ["Manager"],
  claims: { "teams:teamId": "eng" },
});
// Kept for scenarios we'll add to Phase 3 (Manager crossing teams).
const _managerOps = createTestUser({
  id: "22222222-0000-4000-8000-000000000002",
  tenantId: tenant,
  roles: ["Manager"],
  claims: { "teams:teamId": "ops" },
});
const driverAlice = createTestUser({
  id: "33333333-0000-4000-8000-000000000001",
  tenantId: tenant,
  roles: ["Driver"],
});
const driverBob = createTestUser({
  id: "33333333-0000-4000-8000-000000000002",
  tenantId: tenant,
  roles: ["Driver"],
});
// User with BOTH Driver + Manager — the Straddle-attack test runs as them.
const straddler = createTestUser({
  id: "44444444-0000-4000-8000-000000000001",
  tenantId: tenant,
  roles: ["Driver", "Manager"],
  claims: { "teams:teamId": "eng" },
});
const guest = createTestUser({
  id: "55555555-0000-4000-8000-000000000001",
  tenantId: tenant,
  roles: ["Guest"],
});

beforeAll(async () => {
  stack = await setupTestStack({ features: [ordersFeature, teamsFeature] });
  await createEntityTable(stack.db.db, orderEntity, "order");
});

afterAll(async () => {
  await stack.cleanup();
});

let engRow: { id: string; version: number };
let opsRow: { id: string; version: number };

beforeEach(async () => {
  await stack.db.db.execute("DELETE FROM h2w_orders");
  // Admin seeds two rows (one per team), the Eng-row has Alice as driver.
  const eng = await stack.http.writeOk<{ id: string; data: { version: number } }>(
    "worders:write:order:create",
    { teamId: "eng", assigneeId: driverAlice.id, title: "Eng order" },
    admin,
  );
  const ops = await stack.http.writeOk<{ id: string; data: { version: number } }>(
    "worders:write:order:create",
    { teamId: "ops", assigneeId: driverBob.id, title: "Ops order" },
    admin,
  );
  engRow = { id: eng.id, version: eng.data.version };
  opsRow = { id: ops.id, version: ops.data.version };
});

// --- CREATE ---

describe("create-ownership", () => {
  test("Manager eng can create an eng-team row", async () => {
    const res = await stack.http.writeOk<{ id: string }>(
      "worders:write:order:create",
      { teamId: "eng", title: "new" },
      managerEng,
    );
    expect(res.id).toBeTruthy();
  });

  test("Manager eng creating an ops-team row is REJECTED (can't plant foreign-team data)", async () => {
    const err = await stack.http.writeErr(
      "worders:write:order:create",
      { teamId: "ops", title: "rogue" },
      managerEng,
    );
    expectErrorIncludes(err, "entity_ownership_denied");
  });

  test("Guest (no role in map) cannot create anything", async () => {
    const err = await stack.http.writeErr(
      "worders:write:order:create",
      { teamId: "eng", title: "guest" },
      guest,
    );
    expectErrorIncludes(err, "entity_ownership_denied");
  });
});

// --- UPDATE: row-grab + teamId-move attacks ---

describe("update-ownership — row-grab prevention", () => {
  test("Manager eng can update their eng row", async () => {
    const res = await stack.http.writeOk<{ data: { title: string } }>(
      "worders:write:order:update",
      { id: engRow.id, version: engRow.version, changes: { title: "eng updated" } },
      managerEng,
    );
    expect(res.data.title).toBe("eng updated");
  });

  test("Manager eng CANNOT update an ops row (foreign team)", async () => {
    const err = await stack.http.writeErr(
      "worders:write:order:update",
      { id: opsRow.id, version: opsRow.version, changes: { title: "grabbed" } },
      managerEng,
    );
    expectErrorIncludes(err, "entity_ownership_denied");
  });

  test("Manager eng CANNOT move their row to another team (teamId rewrite blocked by post-change check)", async () => {
    // The OLD row has teamId=eng → passes. The NEW row would have teamId=ops
    // → fails the check. Straddle-safe per-role atomic: Manager fails both
    // sides, so rejected.
    const err = await stack.http.writeErr(
      "worders:write:order:update",
      { id: engRow.id, version: engRow.version, changes: { teamId: "ops" } },
      managerEng,
    );
    expectErrorIncludes(err, "entity_ownership_denied");
  });
});

// --- STRADDLE ATTACK — CRITICAL ---

describe("update-ownership — STRADDLE attack prevention", () => {
  test("CRITICAL: user with [Driver, Manager] cannot split old/new check across roles", async () => {
    // Setup: Straddler has BOTH Driver and Manager(eng). The Eng-row has
    // assigneeId=Alice (a different user). An aggregated-role attack would
    // be:
    //   - OLD row: teamId=eng (Manager✓), assigneeId=Alice (Driver for me? ✗)
    //   - NEW row: teamId=ops (Manager✗), assigneeId=me (Driver✓)
    //
    // Aggregated check (any-role ANY side): OLD passes via Manager,
    // NEW passes via Driver → would wrongly allow.
    // Atomic check (one role BOTH sides): neither Manager nor Driver
    // passes both → REJECTED.

    // First setup: update the row so assigneeId is NOT the straddler (so
    // Driver-rule fails on OLD). engRow assigneeId = driverAlice.id, which
    // is already not the straddler — so OLD fails Driver's rule already.

    const err = await stack.http.writeErr(
      "worders:write:order:update",
      {
        id: engRow.id,
        version: engRow.version,
        changes: { teamId: "ops", assigneeId: straddler.id },
      },
      straddler,
    );
    // The attacker's split: Manager passes OLD (eng team), Driver passes
    // NEW (assignee=me). If the framework were naive (OR-aggregate both
    // sides), this would succeed. Per-role atomic rejects it.
    expectErrorIncludes(err, "entity_ownership_denied");
  });

  test("valid case: same user updates a row their Manager role owns on BOTH sides", async () => {
    // Straddler (Manager-eng) updates eng row, keeps it in eng → Manager
    // passes both sides atomically → OK.
    const res = await stack.http.writeOk<{ data: { title: string } }>(
      "worders:write:order:update",
      { id: engRow.id, version: engRow.version, changes: { title: "straddler-ok" } },
      straddler,
    );
    expect(res.data.title).toBe("straddler-ok");
  });
});

// --- DELETE / RESTORE ---

describe("delete-ownership", () => {
  test("Manager eng can delete their eng row", async () => {
    const res = await stack.http.writeOk<{ id: string }>(
      "worders:write:order:delete",
      { id: engRow.id },
      managerEng,
    );
    expect(res.id).toBe(engRow.id);
    // Verify row is gone (or soft-deleted).
    const after = await stack.http.queryOk("worders:query:order:detail", { id: engRow.id }, admin);
    expect(after).toBeNull();
  });

  test("Manager eng CANNOT delete an ops row", async () => {
    const err = await stack.http.writeErr(
      "worders:write:order:delete",
      { id: opsRow.id },
      managerEng,
    );
    expectErrorIncludes(err, "entity_ownership_denied");
    // And the row is still there — the rejection was clean.
    const still = await stack.http.queryOk("worders:query:order:detail", { id: opsRow.id }, admin);
    expect(still).not.toBeNull();
  });

  test("Admin can delete any row", async () => {
    const res = await stack.http.writeOk<{ id: string }>(
      "worders:write:order:delete",
      { id: opsRow.id },
      admin,
    );
    expect(res.id).toBe(opsRow.id);
  });
});

describe("restore-ownership", () => {
  test("Manager eng can restore their own soft-deleted row, but not a foreign one", async () => {
    // Soft-delete both as Admin first.
    await stack.http.writeOk("worders:write:order:delete", { id: engRow.id }, admin);
    await stack.http.writeOk("worders:write:order:delete", { id: opsRow.id }, admin);

    // Eng manager restores eng → OK
    await stack.http.writeOk("worders:write:order:restore", { id: engRow.id }, managerEng);
    // Eng manager tries ops → rejected
    const err = await stack.http.writeErr(
      "worders:write:order:restore",
      { id: opsRow.id },
      managerEng,
    );
    expectErrorIncludes(err, "entity_ownership_denied");
  });
});

// --- Admin-all short-circuit ---

describe("admin-all short-circuit", () => {
  test("Admin can create, update, delete, restore anything", async () => {
    const rogue = await stack.http.writeOk<{ id: string; data: { version: number } }>(
      "worders:write:order:create",
      { teamId: "rogue", title: "admin-created" },
      admin,
    );
    expect(rogue.id).toBeTruthy();

    const updated = await stack.http.writeOk<{ data: { title: string; version: number } }>(
      "worders:write:order:update",
      { id: rogue.id, version: rogue.data.version, changes: { title: "admin-updated" } },
      admin,
    );
    expect(updated.data.title).toBe("admin-updated");

    const deleted = await stack.http.writeOk<{ id: string }>(
      "worders:write:order:delete",
      { id: rogue.id },
      admin,
    );
    expect(deleted.id).toBe(rogue.id);

    const restored = await stack.http.writeOk<{ id: string }>(
      "worders:write:order:restore",
      { id: rogue.id },
      admin,
    );
    expect(restored.id).toBe(rogue.id);
  });
});
