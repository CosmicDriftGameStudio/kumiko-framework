// Ownership Sample — Integration Test
//
// Drives the whole Read/Write × Entity/Field matrix against the contract
// feature. Each test maps directly to a cell in the design-doc matrix.

import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { expectErrorIncludes } from "@cosmicdrift/kumiko-framework/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { contractEntity, contractsFeature, teamsFeature } from "../feature";

let stack: TestStack;
const tenant = testTenantId(1);

const admin = { ...TestUsers.admin, tenantId: tenant };
const teamMemberEng = createTestUser({
  id: "11111111-0000-4000-8000-000000000001",
  tenantId: tenant,
  roles: ["TeamMember"],
  claims: { "teams:teamId": "eng" },
});
const teamMemberOps = createTestUser({
  id: "11111111-0000-4000-8000-000000000002",
  tenantId: tenant,
  roles: ["TeamMember"],
  claims: { "teams:teamId": "ops" },
});
const driverAlice = createTestUser({
  id: "22222222-0000-4000-8000-000000000001",
  tenantId: tenant,
  roles: ["Driver"],
});

beforeAll(async () => {
  stack = await setupTestStack({ features: [teamsFeature, contractsFeature] });
  await unsafeCreateEntityTable(stack.db, contractEntity, "contract");
});

afterAll(async () => {
  await stack.cleanup();
});

let engRowId: string;
let engRowVersion: number;
let opsRowId: string;

beforeEach(async () => {
  await stack.db.execute("DELETE FROM read_ownership_contracts");
  const eng = await stack.http.writeOk<{ id: string; data: { version: number } }>(
    "contracts:write:contract:create",
    {
      teamId: "eng",
      assigneeId: driverAlice.id,
      propA: "public-eng",
      propB: "admin-eng",
      propC: "team-eng",
    },
    admin,
  );
  engRowId = eng.id;
  engRowVersion = eng.data.version;
  const ops = await stack.http.writeOk<{ id: string }>(
    "contracts:write:contract:create",
    {
      teamId: "ops",
      propA: "public-ops",
      propB: "admin-ops",
      propC: "team-ops",
    },
    admin,
  );
  opsRowId = ops.id;
});

// --- Entity-level READ ---

describe("entity-level read: list / detail filtering", () => {
  test("Admin lists both rows", async () => {
    const res = await stack.http.queryOk<{ rows: Array<{ teamId: string }> }>(
      "contracts:query:contract:list",
      {},
      admin,
    );
    expect(res.rows).toHaveLength(2);
  });

  test("TeamMember eng lists only eng's row", async () => {
    const res = await stack.http.queryOk<{ rows: Array<{ teamId: string }> }>(
      "contracts:query:contract:list",
      {},
      teamMemberEng,
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]?.teamId).toBe("eng");
  });

  test("Driver alice lists only rows assigned to her", async () => {
    const res = await stack.http.queryOk<{ rows: Array<{ assigneeId: string }> }>(
      "contracts:query:contract:list",
      {},
      driverAlice,
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]?.assigneeId).toBe(driverAlice.id);
  });

  test("TeamMember eng getting ops row via detail → null (indistinguishable from not-found)", async () => {
    const res = await stack.http.queryOk(
      "contracts:query:contract:detail",
      {
        id: opsRowId,
      },
      teamMemberEng,
    );
    expect(res).toBeNull();
  });
});

// --- Field-level READ ---

describe("field-level read: response JSON strips unreadable fields", () => {
  test("TeamMember eng sees propA + propC; propB missing", async () => {
    const res = await stack.http.queryOk<Record<string, unknown>>(
      "contracts:query:contract:detail",
      { id: engRowId },
      teamMemberEng,
    );
    expect(res["propA"]).toBe("public-eng");
    expect(res["propC"]).toBe("team-eng");
    expect(res).not.toHaveProperty("propB");
  });

  test("TeamMember ops reading eng's row — blocked at entity level (detail=null)", async () => {
    const res = await stack.http.queryOk(
      "contracts:query:contract:detail",
      {
        id: engRowId,
      },
      teamMemberOps,
    );
    expect(res).toBeNull();
  });
});

// --- Entity-level WRITE ---

describe("entity-level write: create/update/delete blocked on foreign rows", () => {
  test("TeamMember eng CANNOT create an ops-team contract", async () => {
    const err = await stack.http.writeErr(
      "contracts:write:contract:create",
      { teamId: "ops", propA: "rogue" },
      teamMemberEng,
    );
    expectErrorIncludes(err, "ownership_denied");
  });

  test("TeamMember eng CANNOT update the ops row (not visible → not modifiable)", async () => {
    // The row exists but entity-level ownership rejects the update.
    // version is guessed — doesn't matter, the ownership check fires first.
    const err = await stack.http.writeErr(
      "contracts:write:contract:update",
      { id: opsRowId, version: 1, changes: { propA: "hack" } },
      teamMemberEng,
    );
    expectErrorIncludes(err, "ownership_denied");
  });

  test("TeamMember eng CANNOT move their row to another team (teamId rewrite blocked)", async () => {
    const err = await stack.http.writeErr(
      "contracts:write:contract:update",
      {
        id: engRowId,
        version: engRowVersion,
        changes: { teamId: "ops" },
      },
      teamMemberEng,
    );
    expectErrorIncludes(err, "ownership_denied");
  });
});

// --- Field-level WRITE ---

describe("field-level write: individual fields rejected fail-loud", () => {
  test("TeamMember eng updating propB (Admin-only) → access_denied (role gate)", async () => {
    const err = await stack.http.writeErr(
      "contracts:write:contract:update",
      {
        id: engRowId,
        version: engRowVersion,
        changes: { propB: "sneak" },
      },
      teamMemberEng,
    );
    expectErrorIncludes(err, "access_denied");
  });

  test("TeamMember eng updating propA succeeds on their own row", async () => {
    const res = await stack.http.writeOk<{ data: { propA: string } }>(
      "contracts:write:contract:update",
      {
        id: engRowId,
        version: engRowVersion,
        changes: { propA: "my-edit" },
      },
      teamMemberEng,
    );
    expect(res.data.propA).toBe("my-edit");
  });
});

// --- Admin short-circuit ---

describe("admin-all short-circuit skips every ownership predicate", () => {
  test("Admin reads both rows with all fields intact", async () => {
    const eng = await stack.http.queryOk<Record<string, unknown>>(
      "contracts:query:contract:detail",
      { id: engRowId },
      admin,
    );
    expect(eng["propA"]).toBe("public-eng");
    expect(eng["propB"]).toBe("admin-eng");
    expect(eng["propC"]).toBe("team-eng");
  });

  test("Admin updates, deletes, restores on any team", async () => {
    const updated = await stack.http.writeOk<{ data: { propB: string; version: number } }>(
      "contracts:write:contract:update",
      {
        id: opsRowId,
        version: 1,
        changes: { propB: "admin-edit-across-teams" },
      },
      admin,
    );
    expect(updated.data.propB).toBe("admin-edit-across-teams");
    const deleted = await stack.http.writeOk<{ id: string }>(
      "contracts:write:contract:delete",
      { id: opsRowId },
      admin,
    );
    expect(deleted.id).toBe(opsRowId);
    const restored = await stack.http.writeOk<{ id: string }>(
      "contracts:write:contract:restore",
      { id: opsRowId },
      admin,
    );
    expect(restored.id).toBe(opsRowId);
  });
});
