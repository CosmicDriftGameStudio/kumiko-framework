// Field-level ownership: individual fields are gated per role + ownership-rule.
// Covers the user's contract example:
//   propA = "all" (public)
//   propB = Admin-only (role)
//   propC = role + ownership (e.g. TeamMember with matching team claim)
//
// Proves: read-side fields are stripped from the response (silent — no
// info-leak about the field's existence); write-side fields are rejected
// loud with `field_ownership_denied` / `field_access_denied` errors.

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

// Contract entity — three fields, each with different access shape.
const contractEntity = createEntity({
  table: "h2f_contracts",
  idType: "uuid",
  fields: {
    teamId: createTextField({ required: true }),
    propA: createTextField(), // public — no access declared
    propB: createTextField({
      access: {
        read: { Admin: "all" },
        write: { Admin: "all" },
      },
    }),
    propC: createTextField({
      access: {
        read: {
          Admin: "all",
          TeamMember: from("claim:teams:teamId"),
        },
        write: {
          Admin: "all",
          TeamMember: from("claim:teams:teamId"),
        },
      },
    }),
  },
});

const contractsFeature = defineFeature("contracts", (r) => {
  r.entity("contract", contractEntity);
  r.writeHandler(
    defineEntityWriteHandler("contract:create", contractEntity, {
      access: { roles: ["Admin", "TeamMember", "Guest"] },
    }),
  );
  r.writeHandler(
    defineEntityWriteHandler("contract:update", contractEntity, {
      access: { roles: ["Admin", "TeamMember", "Guest"] },
    }),
  );
  r.queryHandler(
    defineEntityQueryHandler("contract:detail", contractEntity, {
      access: { roles: ["Admin", "TeamMember", "Guest"] },
    }),
  );
});

const teamsFeature = defineFeature("teams", (r) => {
  r.claimKey("teamId", { type: "string" });
});

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
const guest = createTestUser({
  id: "11111111-0000-4000-8000-000000000099",
  tenantId: tenant,
  roles: ["Guest"],
});

beforeAll(async () => {
  stack = await setupTestStack({ features: [contractsFeature, teamsFeature] });
  await createEntityTable(stack.db.db, contractEntity, "contract");
});

afterAll(async () => {
  await stack.cleanup();
});

let engRowId: string;
let engRowVersion: number;

beforeEach(async () => {
  await stack.db.db.execute("DELETE FROM h2f_contracts");
  const row = await stack.http.writeOk<{ id: string; data: { version: number } }>(
    "contracts:write:contract:create",
    { teamId: "eng", propA: "public-a", propB: "admin-b", propC: "team-c" },
    admin,
  );
  engRowId = row.id;
  engRowVersion = row.data.version;
});

// --- READ SIDE ---

describe("field-level READ: response filtering", () => {
  test("Admin sees all fields", async () => {
    const res = await stack.http.queryOk<Record<string, unknown>>(
      "contracts:query:contract:detail",
      { id: engRowId },
      admin,
    );
    expect(res).toMatchObject({
      teamId: "eng",
      propA: "public-a",
      propB: "admin-b",
      propC: "team-c",
    });
  });

  test("TeamMember eng sees propA, propC — NOT propB (silently stripped)", async () => {
    const res = await stack.http.queryOk<Record<string, unknown>>(
      "contracts:query:contract:detail",
      { id: engRowId },
      teamMemberEng,
    );
    expect(res["propA"]).toBe("public-a");
    expect(res["propC"]).toBe("team-c"); // matches teamId claim
    expect(res).not.toHaveProperty("propB"); // Admin-only, silently removed
  });

  test("TeamMember ops sees propA, but NOT propB and NOT propC (teamId mismatch)", async () => {
    const res = await stack.http.queryOk<Record<string, unknown>>(
      "contracts:query:contract:detail",
      { id: engRowId },
      teamMemberOps,
    );
    expect(res["propA"]).toBe("public-a");
    expect(res).not.toHaveProperty("propB");
    expect(res).not.toHaveProperty("propC"); // ownership rule failed
  });

  test("Guest sees only propA (every other field gated by roles they lack)", async () => {
    const res = await stack.http.queryOk<Record<string, unknown>>(
      "contracts:query:contract:detail",
      { id: engRowId },
      guest,
    );
    expect(res["propA"]).toBe("public-a");
    expect(res).not.toHaveProperty("propB");
    expect(res).not.toHaveProperty("propC");
  });
});

// --- WRITE SIDE ---

describe("field-level WRITE: create", () => {
  test("Admin creates with all fields set", async () => {
    const res = await stack.http.writeOk<{ id: string }>(
      "contracts:write:contract:create",
      { teamId: "ops", propA: "a", propB: "b", propC: "c" },
      admin,
    );
    expect(res.id).toBeTruthy();
  });

  test("TeamMember eng creates a row — can set propA + matching-team propC, but NOT propB (Admin-only)", async () => {
    // propB is role-denied (Admin-only). Dispatcher's role-gate rejects it.
    const err = await stack.http.writeErr(
      "contracts:write:contract:create",
      { teamId: "eng", propA: "a", propB: "sneak", propC: "c" },
      teamMemberEng,
    );
    expectErrorIncludes(err, "access_denied");
  });

  test("TeamMember eng CANNOT set propC when foreign team (ownership denied loud, not silent)", async () => {
    // propC's ownership rule is `from("claim:teams:teamId")`. If the TeamMember
    // tries to create a row with teamId=ops while their claim is eng, the row
    // passes the entity-level check-against-newRow (which would fail, actually),
    // but let's test the field-level block by targeting their OWN team with
    // propC carrying a value the user shouldn't be able to stage.
    // Concretely: member eng creates a row with teamId=ops (entity-level
    // check rejects first) — we exercise the explicit error path.
    const err = await stack.http.writeErr(
      "contracts:write:contract:create",
      { teamId: "ops", propA: "a", propC: "c" },
      teamMemberEng,
    );
    // The entity-level rule fires first (no entity.access.write declared on
    // contract), so it actually reaches field-level. propC requires teamId
    // matching claim — newRow.teamId=ops, claim=eng → denied.
    expectErrorIncludes(err, "field_ownership_denied");
  });
});

describe("field-level WRITE: update", () => {
  test("Admin can update any field", async () => {
    const res = await stack.http.writeOk<{ data: { propB: string } }>(
      "contracts:write:contract:update",
      {
        id: engRowId,
        version: engRowVersion,
        changes: { propB: "admin-edit" },
      },
      admin,
    );
    expect(res.data.propB).toBe("admin-edit");
  });

  test("TeamMember eng CANNOT update propB (Admin-only — dispatcher role-gate blocks)", async () => {
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

  test("TeamMember eng CAN update propC on their own team's row", async () => {
    const res = await stack.http.writeOk<{ data: { propC: string } }>(
      "contracts:write:contract:update",
      {
        id: engRowId,
        version: engRowVersion,
        changes: { propC: "team-eng-edit" },
      },
      teamMemberEng,
    );
    expect(res.data.propC).toBe("team-eng-edit");
  });

  test("TeamMember ops CANNOT update propC on eng's row (ownership mismatch, fail-loud)", async () => {
    // Entity-level access is not declared on contractEntity — the entity lets
    // TeamMember write. Field-level propC's ownership rule requires teamId
    // to match the claim. Ops claim doesn't match row.teamId=eng → the
    // executor's field-ownership check denies propC with the right code.
    const err = await stack.http.writeErr(
      "contracts:write:contract:update",
      {
        id: engRowId,
        version: engRowVersion,
        changes: { propC: "rogue-from-ops" },
      },
      teamMemberOps,
    );
    expectErrorIncludes(err, "field_ownership_denied");
  });

  test("TeamMember eng updating only propA still succeeds (partial change, ownership rule doesn't force every field to be sent)", async () => {
    // Regression guard: checkWriteFieldOwnership walks ONLY the keys in
    // changes — partial updates of public fields must not accidentally
    // trigger ownership rules on unrelated fields.
    const res = await stack.http.writeOk<{ data: { propA: string } }>(
      "contracts:write:contract:update",
      {
        id: engRowId,
        version: engRowVersion,
        changes: { propA: "public-edit" },
      },
      teamMemberEng,
    );
    expect(res.data.propA).toBe("public-edit");
  });
});
