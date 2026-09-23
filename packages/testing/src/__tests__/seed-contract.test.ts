import { describe, expect, test } from "bun:test";
import {
  createSeedUserRequestSchema,
  inboxQuerySchema,
  resolveSeedableRoles,
  SEEDABLE_ROLES,
} from "../e2e/seed-contract";
import { createE2eSeedRoutes } from "../e2e/seed-route";

const TENANT_ID = "0b6ee0e0-2f6c-4f1f-9d5b-6f3f4f3a3c11";

function accepts(schema: ReturnType<typeof createSeedUserRequestSchema>, roles: unknown): boolean {
  return schema.safeParse({ tenantId: TENANT_ID, roles }).success;
}

describe("resolveSeedableRoles", () => {
  test("defaults to the built-in roles", () => {
    expect(resolveSeedableRoles()).toEqual([...SEEDABLE_ROLES]);
  });

  test("appends app roles without duplicating built-in ones", () => {
    expect(resolveSeedableRoles(["TenantMember", "Member", "TenantMember"])).toEqual([
      "TenantAdmin",
      "Member",
      "TenantMember",
    ]);
  });

  test.each(["SystemAdmin", "systemadmin", " SystemAdmin "])("%j is never seedable", (role) => {
    expect(() => resolveSeedableRoles(["TenantMember", role])).toThrow(/never seedable/);
  });

  test.each([[""], ["  "], [7], [undefined], [null]])("rejects the entry %j", (role) => {
    // @cast-boundary engine-bridge — proves the runtime check for untyped JS callers
    const bypassed = [role] as unknown as readonly string[];

    expect(() => resolveSeedableRoles(bypassed)).toThrow(/non-empty strings/);
  });
});

describe("createSeedUserRequestSchema", () => {
  const withAppRole = createSeedUserRequestSchema(["TenantMember"]);

  test("accepts built-in and registered roles, nothing else", () => {
    expect(accepts(withAppRole, ["TenantMember"])).toBe(true);
    expect(accepts(withAppRole, ["TenantAdmin", "TenantMember"])).toBe(true);
    expect(accepts(withAppRole, ["Reviewer"])).toBe(false);
    expect(accepts(withAppRole, ["SystemAdmin"])).toBe(false);
    expect(accepts(withAppRole, ["tenantmember"])).toBe(false);
    expect(accepts(withAppRole, [])).toBe(false);
    expect(accepts(withAppRole, [7])).toBe(false);
    expect(accepts(withAppRole, "TenantMember")).toBe(false);
  });

  test("the default schema knows no app role", () => {
    expect(accepts(createSeedUserRequestSchema(), ["Member"])).toBe(true);
    expect(accepts(createSeedUserRequestSchema(), ["TenantMember"])).toBe(false);
  });

  test("the message names the allowed roles", () => {
    const result = withAppRole.safeParse({ tenantId: TENANT_ID, roles: ["Reviewer"] });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain(
      "allowed: TenantAdmin, Member, TenantMember",
    );
  });
});

describe("inboxQuerySchema", () => {
  test("accepts `to` alone, with no tenantId", () => {
    expect(inboxQuerySchema.safeParse({ to: "a@example.test" }).success).toBe(true);
  });

  test("rejects a missing `to`", () => {
    expect(inboxQuerySchema.safeParse({ tenantId: TENANT_ID }).success).toBe(false);
  });

  test("rejects a non-uuid tenantId", () => {
    expect(
      inboxQuerySchema.safeParse({ tenantId: "not-a-uuid", to: "a@example.test" }).success,
    ).toBe(false);
  });

  test("rejects an unknown key", () => {
    expect(inboxQuerySchema.safeParse({ to: "a@example.test", extra: "nope" }).success).toBe(false);
  });
});

describe("createE2eSeedRoutes options", () => {
  test("refuses SystemAdmin as an extra role when the routes are built", () => {
    expect(() => createE2eSeedRoutes({ extraRoles: ["SystemAdmin"] })).toThrow(/never seedable/);
  });

  test("builds without options and with app roles", () => {
    expect(createE2eSeedRoutes().map((route) => route.entry)).toEqual([
      "signature",
      "signature",
      "signature",
    ]);
    expect(createE2eSeedRoutes({ extraRoles: ["TenantMember"] })).toHaveLength(3);
  });
});
