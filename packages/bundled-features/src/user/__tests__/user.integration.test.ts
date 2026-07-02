import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { expectErrorIncludes, resetTestTables } from "@cosmicdrift/kumiko-framework/testing";
import { UserErrors, UserHandlers, UserQueries } from "../constants";
import { createUserFeature } from "../feature";
import { userEntity, userTable } from "../schema/user";

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
}): Promise<{ id: number }> {
  const res = await stack.http.writeOk<{ id: number }>(
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
      locale: "de", // comes from the entity's default — client didn't send it
    });
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

  test("duplicate email is rejected", async () => {
    await seedUser({ email: "dup@example.com", displayName: "First" });
    const error = await stack.http.writeErr(
      UserHandlers.create,
      { email: "dup@example.com", displayName: "Second" },
      systemAdmin,
    );
    expectErrorIncludes(error, UserErrors.emailAlreadyExists);
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
