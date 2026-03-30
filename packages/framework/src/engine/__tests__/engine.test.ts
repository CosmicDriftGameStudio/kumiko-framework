import { describe, expect, test } from "vitest";
import { z } from "zod";
import { hasAccess } from "../access";
import { createBooleanField, createEntity, createSelectField, createTextField } from "../factories";
import { createApp, createRegistry, defineFeature } from "../index";
import type { PipelineUser } from "../types";

// --- Test Factories ---

function createTestUser(overrides?: Partial<PipelineUser>): PipelineUser {
  return { id: 1, tenantId: 1, roles: ["Admin"], ...overrides };
}

// --- defineFeature ---

describe("defineFeature", () => {
  test("creates a feature with name", () => {
    const feature = defineFeature("test", () => {});
    expect(feature.name).toBe("test");
  });

  test("collects entities", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "user",
        createEntity({
          table: "Users",
          fields: {
            email: createTextField({ searchable: true }),
          },
        }),
      );
    });

    expect(feature.entities["user"]).toBeDefined();
    expect(feature.entities["user"]?.table).toBe("Users");
    expect(feature.entities["user"]?.fields["email"]?.type).toBe("text");
  });

  test("collects write handlers with inferred types", () => {
    const schema = z.object({ email: z.string().email() });

    const feature = defineFeature("test", (r) => {
      r.writeHandler("user.invite", schema, async (event) => {
        // event.payload.email is inferred as string
        const _email: string = event.payload.email;
        return { isSuccess: true, data: { id: 1 } };
      });
    });

    expect(feature.writeHandlers["user.invite"]).toBeDefined();
    expect(feature.writeHandlers["user.invite"]?.name).toBe("user.invite");
  });

  test("collects query handlers with inferred types", () => {
    const schema = z.object({ userId: z.number() });

    const feature = defineFeature("test", (r) => {
      r.queryHandler("user.detail", schema, async (query) => {
        const _id: number = query.payload.userId;
        return { id: _id, email: "test@test.de" };
      });
    });

    expect(feature.queryHandlers["user.detail"]).toBeDefined();
  });

  test("collects translations", () => {
    const feature = defineFeature("test", (r) => {
      r.translations({
        keys: {
          "nav.title": { de: "Benutzer", en: "Users" },
          "field.email": { de: "E-Mail", en: "Email" },
        },
      });
    });

    expect(feature.translations["nav.title"]).toEqual({ de: "Benutzer", en: "Users" });
  });

  test("handlers can have access rules", () => {
    const feature = defineFeature("test", (r) => {
      r.writeHandler(
        "user.invite",
        z.object({ email: z.string() }),
        async () => ({ isSuccess: true, data: null }),
        { access: { roles: ["Admin", "SystemAdmin"] } },
      );
    });

    expect(feature.writeHandlers["user.invite"]?.access?.roles).toEqual(["Admin", "SystemAdmin"]);
  });
});

// --- Field Factories ---

describe("field factories", () => {
  test("createTextField has sensible defaults", () => {
    const field = createTextField();
    expect(field.type).toBe("text");
    expect(field.maxLength).toBe(200);
    expect(field.searchable).toBe(false);
    expect(field.required).toBe(false);
  });

  test("createTextField accepts overrides", () => {
    const field = createTextField({ searchable: true, maxLength: 500, format: "email" });
    expect(field.searchable).toBe(true);
    expect(field.maxLength).toBe(500);
    expect(field.format).toBe("email");
  });

  test("createBooleanField has sensible defaults", () => {
    const field = createBooleanField();
    expect(field.type).toBe("boolean");
    expect(field.default).toBe(false);
  });

  test("createSelectField requires options", () => {
    const field = createSelectField({ options: ["A", "B", "C"] as const });
    expect(field.type).toBe("select");
    expect(field.options).toEqual(["A", "B", "C"]);
  });
});

// --- createRegistry ---

describe("createRegistry", () => {
  test("creates registry from features", () => {
    const feature = defineFeature("admin", (r) => {
      r.entity(
        "user",
        createEntity({
          table: "Users",
          fields: { email: createTextField({ searchable: true }) },
        }),
      );
    });

    const registry = createRegistry([feature]);
    expect(registry.getFeature("admin")).toBeDefined();
  });

  test("looks up entities across features", () => {
    const f1 = defineFeature("admin", (r) => {
      r.entity("user", createEntity({ table: "Users", fields: {} }));
    });
    const f2 = defineFeature("blog", (r) => {
      r.entity("post", createEntity({ table: "Posts", fields: {} }));
    });

    const registry = createRegistry([f1, f2]);
    expect(registry.getEntity("user")?.table).toBe("Users");
    expect(registry.getEntity("post")?.table).toBe("Posts");
    expect(registry.getEntity("nonexistent")).toBeUndefined();
  });

  test("looks up handlers across features", () => {
    const f1 = defineFeature("admin", (r) => {
      r.writeHandler("user.invite", z.object({}), async () => ({ isSuccess: true, data: null }));
    });
    const f2 = defineFeature("profile", (r) => {
      r.queryHandler("profile.me", z.object({}), async () => ({ id: 1 }));
    });

    const registry = createRegistry([f1, f2]);
    expect(registry.getWriteHandler("user.invite")).toBeDefined();
    expect(registry.getQueryHandler("profile.me")).toBeDefined();
  });

  test("throws on duplicate entity names", () => {
    const f1 = defineFeature("a", (r) => {
      r.entity("user", createEntity({ table: "Users", fields: {} }));
    });
    const f2 = defineFeature("b", (r) => {
      r.entity("user", createEntity({ table: "Users2", fields: {} }));
    });

    expect(() => createRegistry([f1, f2])).toThrow(/duplicate entity.*user/i);
  });

  test("throws on duplicate handler names", () => {
    const f1 = defineFeature("a", (r) => {
      r.writeHandler("user.invite", z.object({}), async () => ({ isSuccess: true, data: null }));
    });
    const f2 = defineFeature("b", (r) => {
      r.writeHandler("user.invite", z.object({}), async () => ({ isSuccess: true, data: null }));
    });

    expect(() => createRegistry([f1, f2])).toThrow(/duplicate.*handler.*user\.invite/i);
  });

  test("throws on duplicate feature names", () => {
    const f1 = defineFeature("admin", () => {});
    const f2 = defineFeature("admin", () => {});

    expect(() => createRegistry([f1, f2])).toThrow(/duplicate feature.*admin/i);
  });

  test("merges translations across features", () => {
    const f1 = defineFeature("admin", (r) => {
      r.translations({ keys: { "admin.title": { de: "Admin", en: "Admin" } } });
    });
    const f2 = defineFeature("profile", (r) => {
      r.translations({ keys: { "profile.title": { de: "Profil", en: "Profile" } } });
    });

    const registry = createRegistry([f1, f2]);
    const all = registry.getAllTranslations();
    expect(all["admin.title"]).toEqual({ de: "Admin", en: "Admin" });
    expect(all["profile.title"]).toEqual({ de: "Profil", en: "Profile" });
  });

  test("returns searchable fields for entity", () => {
    const feature = defineFeature("admin", (r) => {
      r.entity(
        "user",
        createEntity({
          table: "Users",
          fields: {
            email: createTextField({ searchable: true }),
            firstName: createTextField(),
            lastName: createTextField({ searchable: true }),
            isEnabled: createBooleanField(),
          },
        }),
      );
    });

    const registry = createRegistry([feature]);
    expect(registry.getSearchableFields("user")).toEqual(["email", "lastName"]);
    expect(registry.getSearchableFields("nonexistent")).toEqual([]);
  });
});

// --- Access ---

describe("hasAccess", () => {
  test.each([
    { userRoles: ["Admin"], requiredRoles: ["Admin"], expected: true },
    { userRoles: ["Admin"], requiredRoles: ["Admin", "SystemAdmin"], expected: true },
    { userRoles: ["Employee"], requiredRoles: ["Admin", "SystemAdmin"], expected: false },
    { userRoles: ["Admin", "Employee"], requiredRoles: ["Employee"], expected: true },
    { userRoles: [], requiredRoles: ["Admin"], expected: false },
    { userRoles: ["Admin"], requiredRoles: [], expected: true },
  ])("user $userRoles vs required $requiredRoles → $expected", ({
    userRoles,
    requiredRoles,
    expected,
  }) => {
    const user = createTestUser({ roles: userRoles });
    expect(hasAccess(user, { roles: requiredRoles })).toBe(expected);
  });

  test("no access rule means everyone has access", () => {
    const user = createTestUser({ roles: ["Employee"] });
    expect(hasAccess(user, undefined)).toBe(true);
  });
});

// --- Entity with softDelete ---

describe("entity options", () => {
  test("softDelete defaults to false", () => {
    const entity = createEntity({ table: "Users", fields: {} });
    expect(entity.softDelete).toBe(false);
  });

  test("softDelete can be enabled", () => {
    const entity = createEntity({ table: "Users", fields: {}, softDelete: true });
    expect(entity.softDelete).toBe(true);
  });
});

// --- Sortable fields ---

describe("sortable fields", () => {
  test("createTextField supports sortable property", () => {
    const field = createTextField({ sortable: true });
    expect(field.sortable).toBe(true);
  });

  test("sortable defaults to false", () => {
    const field = createTextField();
    expect(field.sortable).toBe(false);
  });

  test("registry returns sortable fields for entity", () => {
    const feature = defineFeature("sortTest", (r) => {
      r.entity(
        "item",
        createEntity({
          table: "Items",
          fields: {
            name: createTextField({ sortable: true }),
            email: createTextField(),
            rank: createTextField({ sortable: true }),
          },
        }),
      );
    });

    const registry = createRegistry([feature]);
    expect(registry.getSortableFields("item")).toEqual(["name", "rank"]);
    expect(registry.getSortableFields("nonexistent")).toEqual([]);
  });
});

// --- createApp with role validation ---

describe("createApp", () => {
  test("validates feature roles against app-defined roles", () => {
    const feature = defineFeature("admin", (r) => {
      r.writeHandler("admin.action", z.object({}), async () => ({ isSuccess: true, data: null }), {
        access: { roles: ["SuperAdmin"] },
      });
    });

    expect(() =>
      createApp({
        roles: ["Admin", "User"] as const,
        features: [feature],
      }),
    ).toThrow(/unknown role.*SuperAdmin/i);
  });

  test("passes when all roles are valid", () => {
    const feature = defineFeature("admin", (r) => {
      r.writeHandler("admin.action", z.object({}), async () => ({ isSuccess: true, data: null }), {
        access: { roles: ["Admin"] },
      });
    });

    expect(() =>
      createApp({
        roles: ["Admin", "User"] as const,
        features: [feature],
      }),
    ).not.toThrow();
  });

  test("createApp returns registry", () => {
    const feature = defineFeature("test", () => {});
    const app = createApp({ roles: ["Admin"] as const, features: [feature] });
    expect(app.registry.getFeature("test")).toBeDefined();
  });
});
