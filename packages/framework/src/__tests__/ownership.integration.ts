// H.2 Ownership — Full Leak-Prevention + Row-Grab + Straddle + Field-Level Matrix.
//
// Consolidates the three Phase 1–3 Integration suites (entity-read,
// entity-write, field-level) into one file with shared fixtures. Each
// `describe` block maps to a cell of the core-auth.md Policy-Matrix.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import {
  createEntity,
  createTextField,
  defineEntityQueryHandler,
  defineEntityWriteHandler,
  defineFeature,
  from,
} from "../engine";
import type { SessionUser, TenantId } from "../engine/types";
import {
  createEntityTable,
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
} from "../stack";
import { expectErrorIncludes } from "../testing";

// ── Shared test entity ─────────────────────────────────────────────────────
//
// One entity covers all three layers:
// - Entity-level read + write ownership per role
// - Field-level read + write ownership on specific columns
// - `teamId` + `assigneeId` columns drive both claim-rules and user-rules

const contractEntity = createEntity({
  table: "h2_contracts",
  softDelete: true,
  fields: {
    teamId: createTextField({ required: true }),
    assigneeId: createTextField(),
    title: createTextField({ required: true }),
    // propA: public on read + write
    propA: createTextField(),
    // propB: Admin-only
    propB: createTextField({
      access: { read: { Admin: "all" }, write: { Admin: "all" } },
    }),
    // propC: Admin full, TeamMember scoped to matching teamId
    propC: createTextField({
      access: {
        read: { Admin: "all", TeamMember: from("claim:teams:teamId") },
        write: { Admin: "all", TeamMember: from("claim:teams:teamId") },
      },
    }),
  },
  access: {
    read: {
      Admin: "all",
      Manager: from("claim:teams:teamId"),
      TeamMember: from("claim:teams:teamId"),
      Driver: from("user:id", "assigneeId"),
    },
    write: {
      Admin: "all",
      Manager: from("claim:teams:teamId"),
      TeamMember: from("claim:teams:teamId"),
      Driver: from("user:id", "assigneeId"),
    },
  },
});

const allRoles = ["Admin", "Manager", "TeamMember", "Driver", "Guest"] as const;

const contractsFeature = defineFeature("h2contracts", (r) => {
  r.entity("contract", contractEntity);
  for (const verb of ["create", "update", "delete", "restore"] as const) {
    r.writeHandler(
      defineEntityWriteHandler(`contract:${verb}`, contractEntity, {
        access: { roles: [...allRoles] },
      }),
    );
  }
  for (const verb of ["list", "detail"] as const) {
    r.queryHandler(
      defineEntityQueryHandler(`contract:${verb}`, contractEntity, {
        access: { roles: [...allRoles] },
      }),
    );
  }
});

const teamsFeature = defineFeature("teams", (r) => {
  r.claimKey("teamId", { type: "string" });
});

// ── Shared users ───────────────────────────────────────────────────────────

const tenant = testTenantId(1);

const admin: SessionUser = { ...TestUsers.admin, tenantId: tenant };
const managerEng = mkUser(22, ["Manager"], "eng");
const teamEng = mkUser(33, ["TeamMember"], "eng");
const teamOps = mkUser(34, ["TeamMember"], "ops");
const driverAlice = mkUser(44, ["Driver"], undefined);
const driverBob = mkUser(45, ["Driver"], undefined);
// User with BOTH Driver + Manager — the Straddle-attack test targets this
// combination specifically.
const straddler = mkUser(55, ["Driver", "Manager"], "eng");
const guest = mkUser(66, ["Guest"], undefined);
const noClaimTeamMember = mkUser(77, ["TeamMember"], undefined);

function mkUser(n: number, roles: readonly string[], team: string | undefined): SessionUser {
  return createTestUser({
    id: `11111111-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`,
    tenantId: tenant,
    roles: [...roles],
    ...(team ? { claims: { "teams:teamId": team } } : {}),
  });
}

// ── Test stack ─────────────────────────────────────────────────────────────

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [teamsFeature, contractsFeature] });
  await createEntityTable(stack.db, contractEntity, "contract");
});

afterAll(async () => {
  await stack.cleanup();
});

let engRow: { id: string; version: number };
let opsRow: { id: string; version: number };

beforeEach(async () => {
  await stack.db.execute("DELETE FROM h2_contracts");
  const eng = await stack.http.writeOk<{ id: string; data: { version: number } }>(
    "h2contracts:write:contract:create",
    {
      teamId: "eng",
      assigneeId: driverAlice.id,
      title: "Eng",
      propA: "public-a",
      propB: "admin-b",
      propC: "team-c",
    },
    admin,
  );
  const ops = await stack.http.writeOk<{ id: string; data: { version: number } }>(
    "h2contracts:write:contract:create",
    {
      teamId: "ops",
      assigneeId: driverBob.id,
      title: "Ops",
      propA: "public-a-ops",
      propB: "admin-b-ops",
      propC: "team-c-ops",
    },
    admin,
  );
  engRow = { id: eng.id, version: eng.data.version };
  opsRow = { id: ops.id, version: ops.data.version };
});

// ── Helpers ────────────────────────────────────────────────────────────────

type ListResult = { rows: Array<Record<string, unknown>> };

function list(user: SessionUser): Promise<ListResult> {
  return stack.http.queryOk<ListResult>("h2contracts:query:contract:list", {}, user);
}

function detail(user: SessionUser, id: string): Promise<Record<string, unknown> | null> {
  return stack.http.queryOk("h2contracts:query:contract:detail", { id }, user);
}

// ── Entity-level READ ──────────────────────────────────────────────────────

describe("entity-level READ: list + detail leak-prevention", () => {
  test("Admin lists both rows", async () => {
    const r = await list(admin);
    expect(r.rows).toHaveLength(2);
  });

  test("TeamMember eng lists only eng row", async () => {
    const r = await list(teamEng);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.["teamId"]).toBe("eng");
  });

  test("TeamMember ops lists only ops row (no cross-team leak)", async () => {
    const r = await list(teamOps);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.["teamId"]).toBe("ops");
  });

  test("Driver Alice sees only rows assigned to her", async () => {
    const r = await list(driverAlice);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.["assigneeId"]).toBe(driverAlice.id);
  });

  test("Guest (not in any access-map rule) sees nothing", async () => {
    const r = await list(guest);
    expect(r.rows).toHaveLength(0);
  });

  test("detail() on foreign row → null (indistinguishable from not-found, no info-leak)", async () => {
    expect(await detail(teamEng, opsRow.id)).toBeNull();
    expect(await detail(guest, engRow.id)).toBeNull();
  });

  test("TeamMember eng gets their own row back with all readable fields", async () => {
    const row = await detail(teamEng, engRow.id);
    expect(row?.["teamId"]).toBe("eng");
  });

  test("Missing claim degrades to no-access, not wildcard", async () => {
    expect((await list(noClaimTeamMember)).rows).toHaveLength(0);
  });
});

// ── Entity-level WRITE ─────────────────────────────────────────────────────

describe("entity-level WRITE: create/update/delete/restore", () => {
  test("TeamMember eng creates an eng-team row", async () => {
    const res = await stack.http.writeOk<{ id: string }>(
      "h2contracts:write:contract:create",
      { teamId: "eng", title: "new" },
      teamEng,
    );
    expect(res.id).toBeTruthy();
  });

  test("TeamMember eng CANNOT create an ops-team row", async () => {
    const err = await stack.http.writeErr(
      "h2contracts:write:contract:create",
      { teamId: "ops", title: "rogue" },
      teamEng,
    );
    expectErrorIncludes(err, "ownership_denied");
  });

  test("Guest cannot create anything", async () => {
    const err = await stack.http.writeErr(
      "h2contracts:write:contract:create",
      { teamId: "eng", title: "guest" },
      guest,
    );
    expectErrorIncludes(err, "ownership_denied");
  });

  test("Manager eng can update their eng row", async () => {
    const res = await stack.http.writeOk<{ data: { title: string } }>(
      "h2contracts:write:contract:update",
      { id: engRow.id, version: engRow.version, changes: { title: "edited" } },
      managerEng,
    );
    expect(res.data.title).toBe("edited");
  });

  test("Manager eng CANNOT update a foreign (ops) row", async () => {
    const err = await stack.http.writeErr(
      "h2contracts:write:contract:update",
      { id: opsRow.id, version: opsRow.version, changes: { title: "grabbed" } },
      managerEng,
    );
    expectErrorIncludes(err, "ownership_denied");
  });

  test("Manager eng CANNOT rewrite teamId on their own row (row-grab via column move)", async () => {
    const err = await stack.http.writeErr(
      "h2contracts:write:contract:update",
      { id: engRow.id, version: engRow.version, changes: { teamId: "ops" } },
      managerEng,
    );
    expectErrorIncludes(err, "ownership_denied");
  });

  test("Manager eng deletes their eng row; ops row survives", async () => {
    const res = await stack.http.writeOk<{ id: string }>(
      "h2contracts:write:contract:delete",
      { id: engRow.id },
      managerEng,
    );
    expect(res.id).toBe(engRow.id);
    expect(await detail(admin, engRow.id)).toBeNull();
    expect(await detail(admin, opsRow.id)).not.toBeNull();
  });

  test("Manager eng CANNOT delete a foreign row", async () => {
    const err = await stack.http.writeErr(
      "h2contracts:write:contract:delete",
      { id: opsRow.id },
      managerEng,
    );
    expectErrorIncludes(err, "ownership_denied");
    expect(await detail(admin, opsRow.id)).not.toBeNull();
  });

  test("Manager eng can restore their own soft-deleted row but not a foreign one", async () => {
    await stack.http.writeOk("h2contracts:write:contract:delete", { id: engRow.id }, admin);
    await stack.http.writeOk("h2contracts:write:contract:delete", { id: opsRow.id }, admin);
    const ok = await stack.http.writeOk<{ id: string }>(
      "h2contracts:write:contract:restore",
      { id: engRow.id },
      managerEng,
    );
    expect(ok.id).toBe(engRow.id);
    const err = await stack.http.writeErr(
      "h2contracts:write:contract:restore",
      { id: opsRow.id },
      managerEng,
    );
    expectErrorIncludes(err, "ownership_denied");
  });

  test("Admin 'all' short-circuit: every write succeeds regardless of row", async () => {
    const created = await stack.http.writeOk<{ id: string; data: { version: number } }>(
      "h2contracts:write:contract:create",
      { teamId: "anything", title: "admin-create" },
      admin,
    );
    expect(created.id).toBeTruthy();
    const updated = await stack.http.writeOk<{ data: { title: string } }>(
      "h2contracts:write:contract:update",
      { id: created.id, version: created.data.version, changes: { title: "admin-edit" } },
      admin,
    );
    expect(updated.data.title).toBe("admin-edit");
    const deleted = await stack.http.writeOk<{ id: string }>(
      "h2contracts:write:contract:delete",
      { id: created.id },
      admin,
    );
    expect(deleted.id).toBe(created.id);
    const restored = await stack.http.writeOk<{ id: string }>(
      "h2contracts:write:contract:restore",
      { id: created.id },
      admin,
    );
    expect(restored.id).toBe(created.id);
  });
});

// ── STRADDLE attack — advisor blocker, kept in its own describe so a ──────
//    refactor accidentally deleting this block is immediately obvious.

describe("entity-level WRITE: Straddle-attack prevention (multi-role atomic)", () => {
  test("CRITICAL: user with [Driver, Manager] cannot split old/new across roles", async () => {
    // Setup: Straddler has BOTH Driver and Manager(eng). The Eng-row's
    // assigneeId is Alice (not the Straddler). An aggregated-role attack
    // would be:
    //   OLD row: teamId=eng   (Manager ✓), assigneeId=Alice (Driver ✗)
    //   NEW row: teamId=ops   (Manager ✗), assigneeId=me    (Driver ✓)
    // Aggregated (OR across roles per side): passes. Atomic (one role both
    // sides): neither Manager nor Driver passes both → BLOCKED.
    const err = await stack.http.writeErr(
      "h2contracts:write:contract:update",
      {
        id: engRow.id,
        version: engRow.version,
        changes: { teamId: "ops", assigneeId: straddler.id },
      },
      straddler,
    );
    expectErrorIncludes(err, "ownership_denied");
  });

  test("Valid: straddler with Manager(eng) updates eng row, keeps it in eng", async () => {
    const res = await stack.http.writeOk<{ data: { title: string } }>(
      "h2contracts:write:contract:update",
      { id: engRow.id, version: engRow.version, changes: { title: "straddler-ok" } },
      straddler,
    );
    expect(res.data.title).toBe("straddler-ok");
  });
});

// ── Field-level READ ──────────────────────────────────────────────────────

describe("field-level READ: response JSON strips unreadable fields silently", () => {
  test("Admin sees propA, propB, propC", async () => {
    const r = await detail(admin, engRow.id);
    expect(r).toMatchObject({ propA: "public-a", propB: "admin-b", propC: "team-c" });
  });

  test("TeamMember eng sees propA + propC (team match); propB silently missing", async () => {
    const r = await detail(teamEng, engRow.id);
    expect(r?.["propA"]).toBe("public-a");
    expect(r?.["propC"]).toBe("team-c");
    expect(r).not.toHaveProperty("propB");
  });
});

// ── Field-level WRITE ─────────────────────────────────────────────────────

describe("field-level WRITE: individual fields fail-loud", () => {
  test("TeamMember eng cannot write propB → access_denied (role gate in dispatcher)", async () => {
    const err = await stack.http.writeErr(
      "h2contracts:write:contract:update",
      { id: engRow.id, version: engRow.version, changes: { propB: "sneak" } },
      teamEng,
    );
    expectErrorIncludes(err, "access_denied");
  });

  test("TeamMember ops CANNOT write propC on eng row (ownership denied, fail-loud)", async () => {
    // Entity-level write on ops user against eng row would already fail at
    // the entity-level check. To exercise the field-level path explicitly,
    // teamOps would need entity-level access which it doesn't have — so
    // the entity-level check fires first. Asserting the error code is
    // sufficient: ops can't touch eng's row.
    const err = await stack.http.writeErr(
      "h2contracts:write:contract:update",
      { id: engRow.id, version: engRow.version, changes: { propC: "rogue" } },
      teamOps,
    );
    expectErrorIncludes(err, "ownership_denied");
  });

  test("TeamMember eng CAN write propC on their own team row", async () => {
    const res = await stack.http.writeOk<{ data: { propC: string } }>(
      "h2contracts:write:contract:update",
      { id: engRow.id, version: engRow.version, changes: { propC: "eng-edit" } },
      teamEng,
    );
    expect(res.data.propC).toBe("eng-edit");
  });

  test("Partial update (only propA) doesn't trigger ownership rules on unrelated fields", async () => {
    const res = await stack.http.writeOk<{ data: { propA: string } }>(
      "h2contracts:write:contract:update",
      { id: engRow.id, version: engRow.version, changes: { propA: "partial-edit" } },
      teamEng,
    );
    expect(res.data.propA).toBe("partial-edit");
  });
});

// driverBob is seeded via `assigneeId: driverBob.id` in beforeEach — his
// presence in the seed is what lets us assert Alice doesn't see his row.
// Keep the reference warm so biome doesn't strip the const.
void driverBob.id;
// TenantId import is used as the type parameter on testTenantId() via
// tenantConst above — re-assert via explicit type to silence any TS trim.
const _tenantType: TenantId = tenant;
void _tenantType;
