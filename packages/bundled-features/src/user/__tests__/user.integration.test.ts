import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { createSystemUser } from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  expectErrorIncludes,
  resetTestTables,
  updateRows,
} from "@cosmicdrift/kumiko-framework/testing";
import { UserErrors, UserHandlers, UserQueries } from "../constants";
import { createUserFeature } from "../feature";
import { userEntity, userTable } from "../schema/user";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";

let stack: TestStack;

const systemAdmin = TestUsers.systemAdmin;
const userFeature = createUserFeature();

beforeAll(async () => {
  stack = await setupTestStack({ features: [userFeature] });
  await unsafeCreateEntityTable(stack.db, userEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [userTable]);
});

// Helper: create a user as SystemAdmin and return its id.
async function seedUser(overrides: {
  email: string;
  displayName: string;
  passwordHash?: string;
  roles?: readonly string[];
}): Promise<{ id: string }> {
  const res = await stack.http.writeOk<{ id: string }>(
    UserHandlers.create,
    {
      passwordHash: "seeded-hash",
      ...overrides,
    },
    systemAdmin,
  );
  return { id: res.id };
}

// --- Scenario 1: SystemAdmin creates user, me query returns correct data ---

describe("scenario 1: create + me", () => {
  test("SystemAdmin creates a user, user sees their own profile via me", async () => {
    const created = await seedUser({
      email: "marc@example.com",
      displayName: "Marc",
      passwordHash: "secret-hash",
    });

    const signedIn = createTestUser({ id: created.id, roles: ["User"] });
    const me = await stack.http.queryOk<Record<string, unknown>>(UserQueries.me, {}, signedIn);

    expect(me).toMatchObject({
      id: created.id,
      email: "marc@example.com",
      displayName: "Marc",
    });
    // No entity-level default — client didn't send a locale, so it stays unset.
    expect(me["locale"] == null).toBe(true);
  });

  test("locale sent by the client is persisted and returned via me", async () => {
    const created = await stack.http.writeOk<{ id: number }>(
      UserHandlers.create,
      {
        email: "locale@example.com",
        displayName: "Locale User",
        passwordHash: "seeded-hash",
        locale: "de",
      },
      systemAdmin,
    );

    const signedIn = createTestUser({ id: created.id, roles: ["User"] });
    const me = await stack.http.queryOk<Record<string, unknown>>(UserQueries.me, {}, signedIn);
    expect(me["locale"]).toBe("de");
  });

  test("normal user cannot create another user", async () => {
    const normal = createTestUser({ id: 42, roles: ["User"] });
    const error = await stack.http.writeErr(
      UserHandlers.create,
      { email: "evil@example.com", displayName: "Evil" },
      normal,
    );
    expectErrorIncludes(error, "access_denied");
  });

  test("TenantAdmin cannot create user", async () => {
    const tenantAdmin = createTestUser({ id: 8888, roles: ["TenantAdmin"] });
    const error = await stack.http.writeErr(
      UserHandlers.create,
      { email: "tenantadmin-user-create@example.com", displayName: "Denied" },
      tenantAdmin,
    );
    expectErrorIncludes(error, "access_denied");
  });

  test("duplicate email is rejected", async () => {
    await seedUser({ email: "dup@example.com", displayName: "First" });
    const error = await stack.http.writeErr(
      UserHandlers.create,
      { email: "dup@example.com", displayName: "Second" },
      systemAdmin,
    );
    expectErrorIncludes(error, UserErrors.emailAlreadyExists);
  });

  // fw#2134 — the pre-flight fetchOne alone can't decide a genuine race
  // (both requests can see "no duplicate" before either commits); this
  // fires two real concurrent HTTP creates and checks the loser still
  // gets a clean 4xx, never an unhandled 500. The DB-constraint-level
  // proof (which layer actually catches the race, and that it's the
  // blind-index column doing it) lives in
  // email-unique-blind-index.integration.test.ts — this test's job is
  // narrower: no request may 500 no matter who wins.
  test("two concurrent creates with the same email: loser gets a clean 4xx, not a 500", async () => {
    const email = "concurrent@example.com";
    const [resA, resB] = await Promise.all([
      stack.http.write(UserHandlers.create, { email, displayName: "Racer A" }, systemAdmin),
      stack.http.write(UserHandlers.create, { email, displayName: "Racer B" }, systemAdmin),
    ]);

    const bodyA = (await resA.json()) as { isSuccess: boolean };
    const bodyB = (await resB.json()) as { isSuccess: boolean };
    const successes = [bodyA, bodyB].filter((b) => b.isSuccess === true);
    const failures = [
      { status: resA.status, body: bodyA },
      { status: resB.status, body: bodyB },
    ].filter((r) => r.body.isSuccess === false);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    const loser = failures[0];
    if (!loser) throw new Error("expected exactly one failing response");
    expect(loser.status).toBeGreaterThanOrEqual(400);
    expect(loser.status).toBeLessThan(500);
  });
});

// --- Scenario 2: field-level read access hides passwordHash ---

describe("scenario 2: field-level read access", () => {
  test("user profile does not expose passwordHash via me", async () => {
    const created = await seedUser({
      email: "secret@example.com",
      displayName: "Secret",
      passwordHash: "must-stay-hidden",
    });

    const signedIn = createTestUser({ id: created.id, roles: ["User"] });
    const me = await stack.http.queryOk<Record<string, unknown>>(UserQueries.me, {}, signedIn);

    expect(me).not.toHaveProperty("passwordHash");
    // Sanity: the value is actually stored, just hidden from this role
    const [row] = await selectMany(stack.db, userTable);
    expect((row as { passwordHash: string }).passwordHash).toBe("must-stay-hidden");
  });
});

// --- find-for-auth is system-only: it returns the raw row incl. passwordHash,
// and every query handler is reachable via POST /api/query — so even a
// SystemAdmin (assignable app role) must be denied over HTTP. ---

describe("scenario 2b: find-for-auth is system-only", () => {
  test("SystemAdmin over HTTP is denied — passwordHash must not leak", async () => {
    await seedUser({
      email: "auth-lookup@example.com",
      displayName: "AuthLookup",
      passwordHash: "must-never-leave-the-server",
    });

    const res = await stack.http.queryWithHeaders(
      UserQueries.findForAuth,
      { email: "auth-lookup@example.com" },
      systemAdmin,
      {},
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = await res.text();
    expect(body).toContain("access_denied");
    expect(body).not.toContain("must-never-leave-the-server");
  });

  // The "system" role reaches find-for-auth from any tenant — user rows are
  // tenant-agnostic identity records, not scoped to the caller's own tenant.
  test("system caller from a different tenant still resolves the user", async () => {
    const created = await seedUser({
      email: "cross-tenant@example.com",
      displayName: "CrossTenant",
      passwordHash: "cross-tenant-hash",
    });

    const foreignSystemCaller = createSystemUser(testTenantId(99));
    const result = await stack.http.queryOk<{ id: number } | null>(
      UserQueries.findForAuth,
      { email: "cross-tenant@example.com" },
      foreignSystemCaller,
    );

    expect(result).toMatchObject({ id: created.id });
  });
});

// --- Scenario 3: user edits own profile, email/passwordHash are system-locked ---

describe("scenario 3: self-update + field-level write access", () => {
  test("user can change their own displayName + locale", async () => {
    const created = await seedUser({ email: "editor@example.com", displayName: "Before" });
    const signedIn = createTestUser({ id: created.id, roles: ["User"] });

    await stack.http.writeOk(
      UserHandlers.update,
      { id: created.id, changes: { displayName: "After", locale: "en" }, version: 1 },
      signedIn,
    );

    const me = await stack.http.queryOk<Record<string, unknown>>(UserQueries.me, {}, signedIn);
    expect(me).toMatchObject({ displayName: "After", locale: "en" });
  });

  test("user cannot change their own email (field-level write-locked to system)", async () => {
    const created = await seedUser({ email: "locked@example.com", displayName: "Locked" });
    const signedIn = createTestUser({ id: created.id, roles: ["User"] });

    const error = await stack.http.writeErr(
      UserHandlers.update,
      { id: created.id, changes: { email: "changed@example.com" }, version: 1 },
      signedIn,
    );
    expectErrorIncludes(error, "field_access_denied");

    // Email is unchanged in the DB
    const [row] = await selectMany(stack.db, userTable);
    expect((row as { email: string }).email).toBe("locked@example.com");
  });

  test("user cannot update someone else's profile", async () => {
    const victim = await seedUser({ email: "victim@example.com", displayName: "Victim" });
    const attacker = createTestUser({ id: victim.id + 1000, roles: ["User"] });

    const error = await stack.http.writeErr(
      UserHandlers.update,
      { id: victim.id, changes: { displayName: "Pwned" }, version: 1 },
      attacker,
    );
    expectErrorIncludes(error, UserErrors.cannotEditOtherUser);
  });
});

// --- Scenario 4: detail + list are SystemAdmin-only ---

describe("scenario 4: detail + list access", () => {
  test("SystemAdmin can fetch any user via detail", async () => {
    const target = await seedUser({ email: "target@example.com", displayName: "Target" });

    const detail = await stack.http.queryOk<Record<string, unknown>>(
      UserQueries.detail,
      { id: target.id },
      systemAdmin,
    );

    expect(detail).toMatchObject({ id: target.id, email: "target@example.com" });
  });

  test("tenant Admin cannot fetch arbitrary users (role leak guard)", async () => {
    const target = await seedUser({ email: "other@example.com", displayName: "Other" });
    const tenantAdmin = createTestUser({ id: 9999, roles: ["Admin"] });

    const res = await stack.http.query(UserQueries.detail, { id: target.id }, tenantAdmin);
    expect(res.status).toBe(403);
  });

  test("TenantAdmin cannot fetch arbitrary users via detail", async () => {
    const target = await seedUser({
      email: "tenantadmin-target@example.com",
      displayName: "Target",
    });
    const tenantAdmin = createTestUser({ id: 9998, roles: ["TenantAdmin"] });

    const res = await stack.http.query(UserQueries.detail, { id: target.id }, tenantAdmin);
    expect(res.status).toBe(403);
  });

  test("normal user cannot fetch arbitrary users via detail", async () => {
    const target = await seedUser({ email: "normal-target@example.com", displayName: "Target" });
    const normal = createTestUser({ id: 2001, roles: ["User"] });

    const res = await stack.http.query(UserQueries.detail, { id: target.id }, normal);
    expect(res.status).toBe(403);
  });

  test("list returns users (SystemAdmin only)", async () => {
    await seedUser({ email: "a@example.com", displayName: "A" });
    await seedUser({ email: "b@example.com", displayName: "B" });

    const result = await stack.http.queryOk<{ rows: Record<string, unknown>[] }>(
      UserQueries.list,
      {},
      systemAdmin,
    );

    expect(result.rows.length).toBeGreaterThanOrEqual(2);
  });

  test("normal user cannot list", async () => {
    const signedIn = createTestUser({ id: 2000, roles: ["User"] });
    const res = await stack.http.query(UserQueries.list, {}, signedIn);
    expect(res.status).toBe(403);
  });

  test("TenantAdmin cannot list users", async () => {
    const signedIn = createTestUser({ id: 2002, roles: ["TenantAdmin"] });
    const res = await stack.http.query(UserQueries.list, {}, signedIn);
    expect(res.status).toBe(403);
  });

  test("tenant Admin cannot list users", async () => {
    const signedIn = createTestUser({ id: 2003, roles: ["Admin"] });
    const res = await stack.http.query(UserQueries.list, {}, signedIn);
    expect(res.status).toBe(403);
  });
});

// --- Scenario 8 (575/1): entityEdit round-trip via convention QNs ---
//
// The boot-validator does not check that an entityEdit has a matching
// update/detail handler — the tenant feature closes this gap with its own
// scenario 8 (create -> detail -> update -> reload -> assert); user had no
// equivalent. Scenarios 3/4 exercise update and detail separately (update
// verified via the `me` query, detail verified as a read-only fetch) but
// never chain detail -> update -> detail the way the entityEdit screen
// actually drives its data — this is that missing round-trip proof.

describe("scenario 8: entityEdit round-trip via convention QNs", () => {
  test("user:query:user:detail + user:write:user:update round-trip (entityEdit save persists)", async () => {
    const created = await seedUser({ email: "roundtrip@example.com", displayName: "Before" });

    const loaded = await stack.http.queryOk<Record<string, unknown>>(
      UserQueries.detail,
      { id: created.id },
      systemAdmin,
    );
    expect(loaded["displayName"]).toBe("Before");

    await stack.http.writeOk(
      UserHandlers.update,
      { id: created.id, changes: { displayName: "After" }, version: loaded["version"] },
      systemAdmin,
    );

    const reloaded = await stack.http.queryOk<Record<string, unknown>>(
      UserQueries.detail,
      { id: created.id },
      systemAdmin,
    );
    expect(reloaded["displayName"]).toBe("After");
  });
});

describe("scenario 5: global roles mutation & elevation guard (#2388)", () => {
  test("SystemAdmin updates target user roles to SystemAdmin", async () => {
    const created = await seedUser({ email: "promotee@example.com", displayName: "Promotee" });
    const loaded = await stack.http.queryOk<Record<string, unknown>>(
      UserQueries.detail,
      { id: created.id },
      systemAdmin,
    );

    await stack.http.writeOk(
      UserHandlers.update,
      {
        id: created.id,
        version: loaded["version"],
        changes: { roles: ["SystemAdmin"] },
      },
      systemAdmin,
    );

    const reloaded = await stack.http.queryOk<Record<string, unknown>>(
      UserQueries.detail,
      { id: created.id },
      systemAdmin,
    );
    expect(parseRoles(reloaded["roles"])).toEqual(["SystemAdmin"]);
  });

  test("promoted user with SystemAdmin role can perform SystemAdmin-only queries", async () => {
    const created = await seedUser({
      email: "promoted-admin@example.com",
      displayName: "PromotedAdmin",
    });
    const loaded = await stack.http.queryOk<Record<string, unknown>>(
      UserQueries.detail,
      { id: created.id },
      systemAdmin,
    );

    await stack.http.writeOk(
      UserHandlers.update,
      {
        id: created.id,
        version: loaded["version"],
        changes: { roles: ["SystemAdmin"] },
      },
      systemAdmin,
    );

    const newlyPromoted = createTestUser({ id: created.id, roles: ["SystemAdmin"] });
    const listResult = await stack.http.queryOk<{ rows: Record<string, unknown>[] }>(
      UserQueries.list,
      {},
      newlyPromoted,
    );
    expect(listResult.rows.length).toBeGreaterThanOrEqual(1);
  });

  test("SystemAdmin updates target user roles to multiple valid roles", async () => {
    const created = await seedUser({ email: "multirole@example.com", displayName: "MultiRole" });
    const loaded = await stack.http.queryOk<Record<string, unknown>>(
      UserQueries.detail,
      { id: created.id },
      systemAdmin,
    );

    await stack.http.writeOk(
      UserHandlers.update,
      {
        id: created.id,
        version: loaded["version"],
        changes: { roles: ["User", "Editor"] },
      },
      systemAdmin,
    );

    const reloaded = await stack.http.queryOk<Record<string, unknown>>(
      UserQueries.detail,
      { id: created.id },
      systemAdmin,
    );
    expect(parseRoles(reloaded["roles"])).toEqual(["User", "Editor"]);
  });

  test("TenantAdmin gets 403 on global role mutation (HTTP level check)", async () => {
    const target = await seedUser({ email: "victim-role@example.com", displayName: "Target" });
    const loaded = await stack.http.queryOk<Record<string, unknown>>(
      UserQueries.detail,
      { id: target.id },
      systemAdmin,
    );

    const tenantAdmin = createTestUser({ id: 8888, roles: ["TenantAdmin"] });
    const res = await stack.http.write(
      UserHandlers.update,
      {
        id: target.id,
        version: loaded["version"],
        changes: { roles: ["SystemAdmin"] },
      },
      tenantAdmin,
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("access_denied");
  });

  test("TenantAdmin gets 403 when attempting to assign global roles to self", async () => {
    const tenantAdmin = await seedUser({
      email: "tenant-admin-self@example.com",
      displayName: "TAdmin",
    });
    const loaded = await stack.http.queryOk<Record<string, unknown>>(
      UserQueries.detail,
      { id: tenantAdmin.id },
      systemAdmin,
    );

    const actor = createTestUser({ id: tenantAdmin.id, roles: ["TenantAdmin"] });
    // Field-level write ACL on roles fires before handler elevation guard.
    const error = await stack.http.writeErr(
      UserHandlers.update,
      {
        id: tenantAdmin.id,
        version: loaded["version"],
        changes: { roles: ["SystemAdmin"] },
      },
      actor,
    );
    expectErrorIncludes(error, "field_access_denied");
  });

  test("normal user gets 403 when attempting to assign global roles to self", async () => {
    const user = await seedUser({ email: "self-elevate@example.com", displayName: "SelfElevate" });
    const loaded = await stack.http.queryOk<Record<string, unknown>>(
      UserQueries.detail,
      { id: user.id },
      systemAdmin,
    );

    const normalUser = createTestUser({ id: user.id, roles: ["User"] });
    // Field-level write ACL on roles fires before handler elevation guard.
    const error = await stack.http.writeErr(
      UserHandlers.update,
      {
        id: user.id,
        version: loaded["version"],
        changes: { roles: ["SystemAdmin"] },
      },
      normalUser,
    );
    expectErrorIncludes(error, "field_access_denied");
  });

  test("normal user gets 403 when attempting to assign global roles to another user", async () => {
    const target = await seedUser({
      email: "target-user-roles@example.com",
      displayName: "Target",
    });
    const loaded = await stack.http.queryOk<Record<string, unknown>>(
      UserQueries.detail,
      { id: target.id },
      systemAdmin,
    );

    const attacker = createTestUser({ id: 99999, roles: ["User"] });
    const res = await stack.http.write(
      UserHandlers.update,
      {
        id: target.id,
        version: loaded["version"],
        changes: { roles: ["SystemAdmin"] },
      },
      attacker,
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: { code?: string; details?: { reason?: string } } };
    expect(body.error?.code).toBe("access_denied");
  });

  test("elevation guard rejects unknown role assignment", async () => {
    const target = await seedUser({ email: "unknown-role@example.com", displayName: "Target" });
    const loaded = await stack.http.queryOk<Record<string, unknown>>(
      UserQueries.detail,
      { id: target.id },
      systemAdmin,
    );

    const res = await stack.http.write(
      UserHandlers.update,
      {
        id: target.id,
        version: loaded["version"],
        changes: { roles: ["SuperPowerUnknown"] },
      },
      systemAdmin,
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: { code?: string; details?: { reason?: string } } };
    expect(body.error?.code).toBe("access_denied");
    expect(body.error?.details?.reason).toBe(UserErrors.roleElevationForbidden);
  });

  test("elevation guard rejects unknown role on user:create", async () => {
    const res = await stack.http.write(
      UserHandlers.create,
      {
        email: "unknown-role-create@example.com",
        displayName: "BadRole",
        roles: ["UnknownRole"],
      },
      systemAdmin,
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: { code?: string; details?: { reason?: string } } };
    expect(body.error?.code).toBe("access_denied");
    expect(body.error?.details?.reason).toBe(UserErrors.roleElevationForbidden);
  });
});

describe("scenario 6: last active SystemAdmin protection (#2388)", () => {
  test("refuses removing/demoting the last active SystemAdmin", async () => {
    const onlyAdmin = await seedUser({
      email: "only-admin@example.com",
      displayName: "OnlyAdmin",
      roles: ["SystemAdmin"],
    });
    const loaded = await stack.http.queryOk<Record<string, unknown>>(
      UserQueries.detail,
      { id: onlyAdmin.id },
      systemAdmin,
    );

    // Demoting the only active SystemAdmin must fail with 409
    const res = await stack.http.write(
      UserHandlers.update,
      {
        id: onlyAdmin.id,
        version: loaded["version"],
        changes: { roles: ["User"] },
      },
      systemAdmin,
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error?: { code?: string; details?: { reason?: string } } };
    expect(body.error?.code).toBe("conflict");
    expect(body.error?.details?.reason).toBe(UserErrors.cannotDemoteLastSystemAdmin);

    // Now seed a second SystemAdmin
    const secondAdmin = await seedUser({
      email: "second-admin@example.com",
      displayName: "SecondAdmin",
      roles: ["SystemAdmin"],
    });

    // Demoting onlyAdmin now succeeds (since secondAdmin remains active)
    await stack.http.writeOk(
      UserHandlers.update,
      {
        id: onlyAdmin.id,
        version: loaded["version"],
        changes: { roles: ["User"] },
      },
      systemAdmin,
    );

    // But demoting secondAdmin must now fail (it's the only remaining active SystemAdmin)
    const secondLoaded = await stack.http.queryOk<Record<string, unknown>>(
      UserQueries.detail,
      { id: secondAdmin.id },
      systemAdmin,
    );
    const resSecond = await stack.http.write(
      UserHandlers.update,
      {
        id: secondAdmin.id,
        version: secondLoaded["version"],
        changes: { roles: ["User"] },
      },
      systemAdmin,
    );

    expect(resSecond.status).toBe(409);
    const bodySecond = (await resSecond.json()) as {
      error?: { code?: string; details?: { reason?: string } };
    };
    expect(bodySecond.error?.code).toBe("conflict");
    expect(bodySecond.error?.details?.reason).toBe(UserErrors.cannotDemoteLastSystemAdmin);
  });

  test("refuses setting empty roles on the last active SystemAdmin", async () => {
    const onlyAdmin = await seedUser({
      email: "empty-roles-admin@example.com",
      displayName: "EmptyRolesAdmin",
      roles: ["SystemAdmin"],
    });
    const loaded = await stack.http.queryOk<Record<string, unknown>>(
      UserQueries.detail,
      { id: onlyAdmin.id },
      systemAdmin,
    );

    const res = await stack.http.write(
      UserHandlers.update,
      {
        id: onlyAdmin.id,
        version: loaded["version"],
        changes: { roles: [] },
      },
      systemAdmin,
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error?: { code?: string; details?: { reason?: string } } };
    expect(body.error?.code).toBe("conflict");
    expect(body.error?.details?.reason).toBe(UserErrors.cannotDemoteLastSystemAdmin);
  });

  test("non-role updates on the last active SystemAdmin succeed", async () => {
    const onlyAdmin = await seedUser({
      email: "non-role-admin@example.com",
      displayName: "InitialAdminName",
      roles: ["SystemAdmin"],
    });
    const loaded = await stack.http.queryOk<Record<string, unknown>>(
      UserQueries.detail,
      { id: onlyAdmin.id },
      systemAdmin,
    );

    await stack.http.writeOk(
      UserHandlers.update,
      {
        id: onlyAdmin.id,
        version: loaded["version"],
        changes: { displayName: "UpdatedAdminName" },
      },
      systemAdmin,
    );

    const reloaded = await stack.http.queryOk<Record<string, unknown>>(
      UserQueries.detail,
      { id: onlyAdmin.id },
      systemAdmin,
    );
    expect(reloaded["displayName"]).toBe("UpdatedAdminName");
  });

  test("updating non-SystemAdmin user roles succeeds when only one SystemAdmin exists", async () => {
    // Seed 1 active SystemAdmin
    await seedUser({
      email: "the-system-admin@example.com",
      displayName: "TheAdmin",
      roles: ["SystemAdmin"],
    });

    // Seed a normal user
    const normalUser = await seedUser({
      email: "regular-user@example.com",
      displayName: "RegularUser",
      roles: ["User"],
    });
    const loaded = await stack.http.queryOk<Record<string, unknown>>(
      UserQueries.detail,
      { id: normalUser.id },
      systemAdmin,
    );

    // Updating normal user roles to ["User", "Editor"] should succeed without conflict
    await stack.http.writeOk(
      UserHandlers.update,
      {
        id: normalUser.id,
        version: loaded["version"],
        changes: { roles: ["User", "Editor"] },
      },
      systemAdmin,
    );

    const reloaded = await stack.http.queryOk<Record<string, unknown>>(
      UserQueries.detail,
      { id: normalUser.id },
      systemAdmin,
    );
    expect(parseRoles(reloaded["roles"])).toEqual(["User", "Editor"]);
  });

  test("concurrent demotions of the last two SystemAdmins: one wins, one gets 409", async () => {
    const adminA = await seedUser({
      email: "race-admin-a@example.com",
      displayName: "Race Admin A",
      roles: ["SystemAdmin"],
    });
    const adminB = await seedUser({
      email: "race-admin-b@example.com",
      displayName: "Race Admin B",
      roles: ["SystemAdmin"],
    });

    const loadedA = await stack.http.queryOk<Record<string, unknown>>(
      UserQueries.detail,
      { id: adminA.id },
      systemAdmin,
    );
    const loadedB = await stack.http.queryOk<Record<string, unknown>>(
      UserQueries.detail,
      { id: adminB.id },
      systemAdmin,
    );

    const [resA, resB] = await Promise.all([
      stack.http.write(
        UserHandlers.update,
        {
          id: adminA.id,
          version: loadedA["version"],
          changes: { roles: ["User"] },
        },
        systemAdmin,
      ),
      stack.http.write(
        UserHandlers.update,
        {
          id: adminB.id,
          version: loadedB["version"],
          changes: { roles: ["User"] },
        },
        systemAdmin,
      ),
    ]);

    const bodyA = (await resA.json()) as {
      isSuccess: boolean;
      error?: { code?: string; details?: { reason?: string } };
    };
    const bodyB = (await resB.json()) as {
      isSuccess: boolean;
      error?: { code?: string; details?: { reason?: string } };
    };

    const outcomes = [
      { status: resA.status, body: bodyA },
      { status: resB.status, body: bodyB },
    ];
    const successes = outcomes.filter((o) => o.body.isSuccess === true);
    const failures = outcomes.filter((o) => o.body.isSuccess === false);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    const loser = failures[0];
    if (!loser) throw new Error("expected exactly one failing demotion");
    expect(loser.status).toBe(409);
    expect(loser.body.error?.code).toBe("conflict");
    expect(loser.body.error?.details?.reason).toBe(UserErrors.cannotDemoteLastSystemAdmin);

    // Exactly one active SystemAdmin must remain among the two race targets.
    const stillAdmin = await Promise.all(
      [adminA.id, adminB.id].map(async (id) => {
        const row = await stack.http.queryOk<Record<string, unknown>>(
          UserQueries.detail,
          { id },
          systemAdmin,
        );
        return parseRoles(row["roles"]).includes("SystemAdmin");
      }),
    );
    expect(stillAdmin.filter(Boolean)).toHaveLength(1);
  });

  test("soft-deleted SystemAdmin does not count toward last-admin protection", async () => {
    const activeAdmin = await seedUser({
      email: "active-admin@example.com",
      displayName: "ActiveAdmin",
      roles: ["SystemAdmin"],
    });
    const softDeletedAdmin = await seedUser({
      email: "deleted-admin@example.com",
      displayName: "DeletedAdmin",
      roles: ["SystemAdmin"],
    });

    // Soft-delete the second admin directly
    await updateRows(stack.db, userTable, { isDeleted: true }, { id: softDeletedAdmin.id });

    // Attempting to demote activeAdmin must fail with 409 because the other is deleted
    const loaded = await stack.http.queryOk<Record<string, unknown>>(
      UserQueries.detail,
      { id: activeAdmin.id },
      systemAdmin,
    );
    const res = await stack.http.write(
      UserHandlers.update,
      {
        id: activeAdmin.id,
        version: loaded["version"],
        changes: { roles: ["User"] },
      },
      systemAdmin,
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error?: { code?: string; details?: { reason?: string } } };
    expect(body.error?.code).toBe("conflict");
    expect(body.error?.details?.reason).toBe(UserErrors.cannotDemoteLastSystemAdmin);
  });
});
