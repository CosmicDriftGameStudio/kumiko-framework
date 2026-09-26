import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { verifyPassword } from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import {
  TenantQueries,
  tenantMembershipsTable,
  tenantTable,
} from "@cosmicdrift/kumiko-bundled-features/tenant";
import { userTable } from "@cosmicdrift/kumiko-bundled-features/user";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import type { TestStack } from "@cosmicdrift/kumiko-framework/stack";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import { type SeedPart, seedTenant, setupAppTestStack } from "../index";
import { NOTE_CREATE, NOTE_LIST, noteFeature } from "./note-feature";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupAppTestStack([noteFeature]);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("seedTenant (light)", () => {
  test("two tenants get distinct ids, keys and users, and stay isolated from each other", async () => {
    const a = await seedTenant(stack);
    const b = await seedTenant(stack);

    expect(a.id).not.toBe(b.id);
    expect(a.key).not.toBe(b.key);
    expect(a.admin.id).not.toBe(b.admin.id);
    expect(a.admin.email).not.toBe(b.admin.email);
    expect(a.admin.session).toEqual({
      id: a.admin.id,
      tenantId: a.id,
      roles: ["TenantAdmin"],
    });

    await a.api.writeOk(NOTE_CREATE, { title: "only in a" });

    expect(await a.api.queryOk<string[]>(NOTE_LIST, {})).toEqual(["only in a"]);
    expect(await b.api.queryOk<string[]>(NOTE_LIST, {})).toEqual([]);
  });

  test("a supplied name is the display name; the key stays unique", async () => {
    const first = await seedTenant(stack, { name: "meine firma 1" });
    const second = await seedTenant(stack, { name: "meine firma 1" });

    expect(first.name).toBe("meine firma 1");
    expect(second.name).toBe("meine firma 1");
    expect(first.key).not.toBe(second.key);
    expect(first.id).not.toBe(second.id);
  });

  test("users: 2 seeds two distinct Member users who act inside the tenant", async () => {
    const tenant = await seedTenant(stack, { users: 2 });

    expect(tenant.members).toHaveLength(2);
    const [first, second] = tenant.members;
    expect(first?.id).not.toBe(second?.id);
    for (const member of tenant.members) {
      expect(member.session.roles).toEqual(["Member"]);
      expect(member.session.tenantId).toBe(tenant.id);
    }

    await tenant.apiAs(tenant.members[0]!).writeOk(NOTE_CREATE, { title: "from member" });
    expect(await tenant.api.queryOk<string[]>(NOTE_LIST, {})).toEqual(["from member"]);
  });

  test("addUser takes explicit roles, and those roles decide access", async () => {
    const tenant = await seedTenant(stack);

    const reviewer = await tenant.addUser(["Reviewer"]);
    const outsider = await tenant.addUser(["Nobody"]);

    expect(reviewer.session.roles).toEqual(["Reviewer"]);
    await tenant.apiAs(reviewer).writeOk(NOTE_CREATE, { title: "reviewed" });
    const denied = await tenant.apiAs(outsider).writeErr(NOTE_CREATE, { title: "nope" });
    expect(denied.code).toBe("access_denied");
    expect((await tenant.addUser()).session.roles).toEqual(["Member"]);
  });

  test("addUser substitutes {tenantId} in an explicit email, same as the admin identity", async () => {
    const tenant = await seedTenant(stack);

    const member = await tenant.addUser(["Member"], { email: "member-{tenantId}@example.test" });

    expect(member.email).toBe(`member-${tenant.id}@example.test`);
  });

  test("with-parts run in order after the users exist and see the seeded tenant", async () => {
    const order: string[] = [];
    const first: SeedPart = async ({ tenant }) => {
      order.push(`first:${tenant.members.length}`);
      await tenant.api.writeOk(NOTE_CREATE, { title: "from part 1" });
    };
    const second: SeedPart = async ({ tenant }) => {
      order.push("second");
      await tenant.api.writeOk(NOTE_CREATE, { title: "from part 2" });
    };

    const tenant = await seedTenant(stack, { users: 1, with: [first, second] });

    expect(order).toEqual(["first:1", "second"]);
    expect(await tenant.api.queryOk<string[]>(NOTE_LIST, {})).toEqual([
      "from part 1",
      "from part 2",
    ]);
  });

  test("light seeding writes no tenant, user or membership rows", async () => {
    const tenant = await seedTenant(stack);

    expect(await fetchOne(stack.db, tenantTable, { id: tenant.id })).toBeUndefined();
    expect(await fetchOne(stack.db, userTable, { id: tenant.admin.id })).toBeUndefined();
    expect(
      await fetchOne(stack.db, tenantMembershipsTable, { tenantId: tenant.id }),
    ).toBeUndefined();
  });
});

describe("seedTenant (persist)", () => {
  test("writes tenant, verified user and membership rows through the dispatcher", async () => {
    const tenant = await seedTenant(stack, { persist: true, name: "persisted gmbh", users: 1 });

    const tenantRow = await fetchOne<{ id: string; key: string; name: string }>(
      stack.db,
      tenantTable,
      { id: tenant.id },
    );
    expect(tenantRow).toMatchObject({ id: tenant.id, key: tenant.key, name: "persisted gmbh" });

    const userRow = await fetchOne<{
      id: string;
      email: string;
      passwordHash: string;
      emailVerified: boolean;
    }>(stack.db, userTable, { id: tenant.admin.id });
    expect(userRow?.email).toBe(tenant.admin.email);
    expect(userRow?.emailVerified).toBe(true);
    expect(await verifyPassword(userRow?.passwordHash ?? "", tenant.admin.password)).toBe(true);
    expect(await verifyPassword(userRow?.passwordHash ?? "", "wrong-password")).toBe(false);

    const membership = await fetchOne<{ roles: string }>(stack.db, tenantMembershipsTable, {
      userId: tenant.admin.id,
      tenantId: tenant.id,
    });
    expect(JSON.parse(membership?.roles ?? "null")).toEqual(["TenantAdmin"]);

    const member = tenant.members[0]!;
    const memberMembership = await fetchOne<{ roles: string }>(stack.db, tenantMembershipsTable, {
      userId: member.id,
      tenantId: tenant.id,
    });
    expect(JSON.parse(memberMembership?.roles ?? "null")).toEqual(["Member"]);
  });

  test("the returned session and api work against the persisted tenant", async () => {
    const tenant = await seedTenant(stack, { persist: true });

    await tenant.api.writeOk(NOTE_CREATE, { title: "persisted note" });

    expect(await tenant.api.queryOk<string[]>(NOTE_LIST, {})).toEqual(["persisted note"]);
    expect(tenant.admin.session.id).toBe(tenant.admin.id);
  });

  test("addUser(['SystemAdmin']) persists a global SystemAdmin who joins the tenant as Member", async () => {
    const tenant = await seedTenant(stack, { persist: true });

    const systemAdmin = await tenant.addUser([ROLES.SystemAdmin]);

    expect(systemAdmin.session.roles).toEqual([ROLES.SystemAdmin, ROLES.Member]);
    const userRow = await fetchOne<{ roles: unknown }>(stack.db, userTable, { id: systemAdmin.id });
    expect(parseRoles(userRow?.roles)).toEqual([ROLES.SystemAdmin]);
    const membership = await fetchOne<{ roles: string }>(stack.db, tenantMembershipsTable, {
      userId: systemAdmin.id,
      tenantId: tenant.id,
    });
    expect(JSON.parse(membership?.roles ?? "null")).toEqual([ROLES.Member]);
    await tenant.apiAs(systemAdmin).queryOk(TenantQueries.list, {});
    expect((await tenant.api.queryErr(TenantQueries.list, {})).code).toBe("access_denied");
  });

  test("seeding two persisted tenants concurrently does not collide", async () => {
    const [a, b] = await Promise.all([
      seedTenant(stack, { persist: true, users: 1 }),
      seedTenant(stack, { persist: true, users: 1 }),
    ]);

    expect(a.id).not.toBe(b.id);
    expect(a.admin.email).not.toBe(b.admin.email);
    expect(await fetchOne(stack.db, tenantTable, { id: a.id })).toBeDefined();
    expect(await fetchOne(stack.db, tenantTable, { id: b.id })).toBeDefined();
  });

  test("fails with the handler name when the tenant feature is not mounted", async () => {
    const bare = await setupAppTestStack([noteFeature], { includeBundled: false });
    try {
      await expect(seedTenant(bare, { persist: true })).rejects.toThrow(/tenant:write:create/);
    } finally {
      await bare.cleanup();
    }
  });
});
