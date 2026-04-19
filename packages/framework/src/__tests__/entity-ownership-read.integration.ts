// Entity-level read-ownership integration: rows the user's role is not
// authorised to see must not come back from list/detail, regardless of
// where they call from. This is the leak-prevention guarantee.

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
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
} from "../testing";

// An entity with entity-level read ownership:
//  - Admin sees everything
//  - TeamMember sees only rows whose teamId matches the user's team claim
//  - Guest role isn't in the map → no access at all
const orderEntity = createEntity({
  table: "h2_orders",
  idType: "uuid",
  fields: {
    teamId: createTextField({ required: true }),
    title: createTextField({ required: true }),
  },
  access: {
    read: {
      Admin: "all",
      TeamMember: from("claim:teams:teamId"),
    },
  },
});

// Feature that also declares the claim — the resolver populates teamId at
// login. For this test we set SessionUser.claims directly via createTestUser.
const ordersFeature = defineFeature("orders", (r) => {
  r.entity("order", orderEntity);
  r.writeHandler(
    defineEntityWriteHandler("order:create", orderEntity, { access: { roles: ["Admin"] } }),
  );
  r.queryHandler(
    defineEntityQueryHandler("order:list", orderEntity, {
      access: { roles: ["Admin", "TeamMember", "Guest"] },
    }),
  );
  r.queryHandler(
    defineEntityQueryHandler("order:detail", orderEntity, {
      access: { roles: ["Admin", "TeamMember", "Guest"] },
    }),
  );
});

// Declares the `teams:teamId` claim so boot-validator + resolver accept it.
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
const guestUser = createTestUser({
  id: "11111111-0000-4000-8000-000000000003",
  tenantId: tenant,
  roles: ["Guest"],
});

beforeAll(async () => {
  stack = await setupTestStack({
    features: [ordersFeature, teamsFeature],
  });
  await createEntityTable(stack.db.db, orderEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

let engOrderId: string;
let opsOrderId: string;

beforeEach(async () => {
  // Delete via raw SQL to stay independent of the drizzle-schema handle.
  await stack.db.db.execute("DELETE FROM h2_orders");
  // Seed two rows, one per team, via the framework's own create handler.
  const eng = await stack.http.writeOk<{ id: string }>(
    "orders:write:order:create",
    { teamId: "eng", title: "Eng order" },
    admin,
  );
  const ops = await stack.http.writeOk<{ id: string }>(
    "orders:write:order:create",
    { teamId: "ops", title: "Ops order" },
    admin,
  );
  engOrderId = eng.id;
  opsOrderId = ops.id;
});

describe("scenario 1: list() applies read ownership", () => {
  test("Admin sees all rows", async () => {
    const res = await stack.http.queryOk<{ rows: Array<{ id: string; teamId: string }> }>(
      "orders:query:order:list",
      {},
      admin,
    );
    expect(res.rows).toHaveLength(2);
    const teamIds = res.rows.map((r) => r.teamId).sort();
    expect(teamIds).toEqual(["eng", "ops"]);
  });

  test("TeamMember eng sees only their team's row", async () => {
    const res = await stack.http.queryOk<{ rows: Array<{ id: string; teamId: string }> }>(
      "orders:query:order:list",
      {},
      teamMemberEng,
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]?.teamId).toBe("eng");
  });

  test("TeamMember ops sees only their team's row (no cross-team leak)", async () => {
    const res = await stack.http.queryOk<{ rows: Array<{ id: string; teamId: string }> }>(
      "orders:query:order:list",
      {},
      teamMemberOps,
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]?.teamId).toBe("ops");
  });

  test("Guest role (not in access map) sees NOTHING (empty result, not error)", async () => {
    const res = await stack.http.queryOk<{ rows: unknown[] }>(
      "orders:query:order:list",
      {},
      guestUser,
    );
    expect(res.rows).toHaveLength(0);
  });
});

describe("scenario 2: detail() applies read ownership", () => {
  test("Admin can detail any row", async () => {
    const eng = await stack.http.queryOk("orders:query:order:detail", { id: engOrderId }, admin);
    const ops = await stack.http.queryOk("orders:query:order:detail", { id: opsOrderId }, admin);
    expect(eng).toBeTruthy();
    expect(ops).toBeTruthy();
  });

  test("TeamMember eng gets null for foreign team's row (not an error — indistinguishable from not-found)", async () => {
    // The advisor-noted info-leak: 'forbidden' vs 'not found' must be
    // indistinguishable from the client's side, so a probing attacker
    // can't enumerate which IDs exist.
    const res = await stack.http.queryOk(
      "orders:query:order:detail",
      { id: opsOrderId },
      teamMemberEng,
    );
    expect(res).toBeNull();
  });

  test("TeamMember eng can detail their own team's row", async () => {
    const res = await stack.http.queryOk<{ teamId: string }>(
      "orders:query:order:detail",
      { id: engOrderId },
      teamMemberEng,
    );
    expect(res?.teamId).toBe("eng");
  });

  test("Guest sees null for any row", async () => {
    expect(
      await stack.http.queryOk("orders:query:order:detail", { id: engOrderId }, guestUser),
    ).toBeNull();
    expect(
      await stack.http.queryOk("orders:query:order:detail", { id: opsOrderId }, guestUser),
    ).toBeNull();
  });
});

describe("scenario 3: missing claim degrades to no-access (not wildcard match)", () => {
  test("TeamMember without the team claim sees nothing", async () => {
    const noClaim = createTestUser({
      id: "11111111-0000-4000-8000-000000000099",
      tenantId: tenant,
      roles: ["TeamMember"],
      // No claims — the resolver didn't populate teamId for this user.
    });
    const res = await stack.http.queryOk<{ rows: unknown[] }>(
      "orders:query:order:list",
      {},
      noClaim,
    );
    expect(res.rows).toHaveLength(0);
  });
});
