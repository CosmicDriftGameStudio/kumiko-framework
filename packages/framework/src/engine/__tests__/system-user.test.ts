import { describe, expect, test } from "vitest";
import { hasAccess } from "../access";
import { createApp } from "../create-app";
import { defineFeature } from "../define-feature";
import { createSystemUser, SYSTEM_ROLE, SYSTEM_USER_ID } from "../system-user";

describe("SYSTEM_USER", () => {
  test("createSystemUser returns user with system role", () => {
    const user = createSystemUser(42);
    expect(user.id).toBe(SYSTEM_USER_ID);
    expect(user.tenantId).toBe(42);
    expect(user.roles).toEqual([SYSTEM_ROLE]);
  });

  test("SYSTEM_USER has access to handlers with roles: ['system']", () => {
    const user = createSystemUser(1);
    expect(hasAccess(user, { roles: ["system"] })).toBe(true);
  });

  test("SYSTEM_USER does NOT have access to Admin-only handlers", () => {
    const user = createSystemUser(1);
    expect(hasAccess(user, { roles: ["Admin"] })).toBe(false);
  });

  test("normal user does NOT have access to system-only handlers", () => {
    const admin = { id: 1, tenantId: 1, roles: ["Admin"] as readonly string[] };
    expect(hasAccess(admin, { roles: ["system"] })).toBe(false);
  });

  test("createApp rejects 'system' as an app role", () => {
    const feature = defineFeature("test", () => {});
    expect(() => createApp({ roles: ["Admin", "system"] as const, features: [feature] })).toThrow(
      /reserved.*SYSTEM_USER/i,
    );
  });

  test("createApp allows features with write: ['system'] config keys", () => {
    const feature = defineFeature("billing", (r) => {
      r.config({
        keys: {
          monthlyTotal: {
            type: "number",
            default: 0,
            scope: "tenant",
            access: { write: ["system"], read: ["Admin"] },
          },
        },
      });
    });

    expect(() => createApp({ roles: ["Admin"] as const, features: [feature] })).not.toThrow();
  });
});
