import { describe, expect, test } from "vitest";
import { z } from "zod";
import { createTestUser } from "../../testing/fixtures";
import { hasAccess } from "../access";
import { defineQueryHandler, defineWriteHandler } from "../define-handler";
import { createBooleanField, createEntity, createSelectField, createTextField } from "../factories";
import { createApp, createRegistry, defineFeature } from "../index";

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

  test("writeHandler returns typed HandlerRef", () => {
    let ref: { name: string } | undefined;
    defineFeature("test", (r) => {
      ref = r.writeHandler("order.create", z.object({}), async () => ({
        isSuccess: true,
        data: null,
      }));
    });
    expect(ref?.name).toBe("order.create");
  });

  test("queryHandler returns typed HandlerRef", () => {
    let ref: { name: string } | undefined;
    defineFeature("test", (r) => {
      ref = r.queryHandler("order.list", z.object({}), async () => []);
    });
    expect(ref?.name).toBe("order.list");
  });

  test("r.defineEvent returns typed EventDef and registers on feature", () => {
    let eventRef: { name: string } | undefined;
    const feature = defineFeature("orders", (r) => {
      eventRef = r.defineEvent("order.created", z.object({ orderId: z.number() }));
    });

    expect(eventRef?.name).toBe("order.created");
    expect(feature.events["order.created"]).toBeDefined();
    expect(feature.events["order.created"]?.schema).toBeDefined();
  });

  test("registry prefixes event names with feature name", () => {
    const feature = defineFeature("orders", (r) => {
      r.defineEvent("order.created", z.object({ orderId: z.number() }));
    });
    const registry = createRegistry([feature]);
    expect(registry.getEvent("orders.order.created")).toBeDefined();
    expect(registry.getEvent("order.created")).toBeUndefined();
  });

  test("collects write handlers via object form (defineWriteHandler)", () => {
    const handler = defineWriteHandler({
      name: "user.create",
      schema: z.object({ email: z.string().email() }),
      access: { roles: ["Admin"] },
      handler: async (event) => {
        return { isSuccess: true, data: { id: 1, email: event.payload.email } };
      },
    });

    const feature = defineFeature("test", (r) => {
      r.writeHandler(handler);
    });

    expect(feature.writeHandlers["user.create"]).toBeDefined();
    expect(feature.writeHandlers["user.create"]?.name).toBe("user.create");
    expect(feature.writeHandlers["user.create"]?.access?.roles).toEqual(["Admin"]);
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

  test("collects query handlers via object form (defineQueryHandler)", () => {
    const handler = defineQueryHandler({
      name: "user.list",
      schema: z.object({ limit: z.number().optional() }),
      handler: async () => {
        return [{ id: 1, email: "test@test.de" }];
      },
    });

    const feature = defineFeature("test", (r) => {
      r.queryHandler(handler);
    });

    expect(feature.queryHandlers["user.list"]).toBeDefined();
    expect(feature.queryHandlers["user.list"]?.name).toBe("user.list");
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
    expect(registry.getEntity("admin.user")?.table).toBe("Users");
    expect(registry.getEntity("blog.post")?.table).toBe("Posts");
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
    expect(registry.getWriteHandler("admin.user.invite")).toBeDefined();
    expect(registry.getQueryHandler("profile.profile.me")).toBeDefined();
  });

  test("throws on duplicate entity names (same feature name)", () => {
    const f1 = defineFeature("shared", (r) => {
      r.entity("user", createEntity({ table: "Users", fields: {} }));
    });
    const f2 = defineFeature("shared", (r) => {
      r.entity("user", createEntity({ table: "Users2", fields: {} }));
    });

    // Duplicate feature name throws first
    expect(() => createRegistry([f1, f2])).toThrow(/duplicate feature.*shared/i);
  });

  test("different features can have same entity short name (prefixed differently)", () => {
    const f1 = defineFeature("a", (r) => {
      r.entity("user", createEntity({ table: "Users", fields: {} }));
    });
    const f2 = defineFeature("b", (r) => {
      r.entity("user", createEntity({ table: "Users2", fields: {} }));
    });

    // No error — "a.user" and "b.user" are distinct
    const registry = createRegistry([f1, f2]);
    expect(registry.getEntity("a.user")?.table).toBe("Users");
    expect(registry.getEntity("b.user")?.table).toBe("Users2");
  });

  test("different features can have same handler short name (prefixed differently)", () => {
    const f1 = defineFeature("a", (r) => {
      r.writeHandler("user.invite", z.object({}), async () => ({ isSuccess: true, data: null }));
    });
    const f2 = defineFeature("b", (r) => {
      r.writeHandler("user.invite", z.object({}), async () => ({ isSuccess: true, data: null }));
    });

    // No error — "a.user.invite" and "b.user.invite" are distinct
    const registry = createRegistry([f1, f2]);
    expect(registry.getWriteHandler("a.user.invite")).toBeDefined();
    expect(registry.getWriteHandler("b.user.invite")).toBeDefined();
  });

  test("throws on duplicate feature names", () => {
    const f1 = defineFeature("admin", () => {});
    const f2 = defineFeature("admin", () => {});

    expect(() => createRegistry([f1, f2])).toThrow(/duplicate feature.*admin/i);
  });

  test("merges translations with feature prefix (i18next namespace)", () => {
    const f1 = defineFeature("admin", (r) => {
      r.translations({ keys: { "nav.title": { de: "Admin", en: "Admin" } } });
    });
    const f2 = defineFeature("profile", (r) => {
      r.translations({ keys: { "nav.title": { de: "Profil", en: "Profile" } } });
    });

    const registry = createRegistry([f1, f2]);
    const all = registry.getAllTranslations();
    // Keys prefixed with featureName: (colon = i18next namespace)
    expect(all["admin:nav.title"]).toEqual({ de: "Admin", en: "Admin" });
    expect(all["profile:nav.title"]).toEqual({ de: "Profil", en: "Profile" });
  });

  test("r.crud() returns typed handler and query refs", () => {
    const feature = defineFeature("orders", (r) => {
      r.entity("order", createEntity({ table: "Orders", fields: { name: createTextField() } }));
      const crud = r.crud("order");

      expect(crud.handlers.create.name).toBe("order.create");
      expect(crud.handlers.update.name).toBe("order.update");
      expect(crud.handlers.delete.name).toBe("order.delete");
      expect(crud.queries.list.name).toBe("order.list");
      expect(crud.queries.detail.name).toBe("order.detail");
    });

    // Verify handlers actually registered
    const registry = createRegistry([feature]);
    expect(registry.getWriteHandler("orders.order.create")).toBeDefined();
    expect(registry.getQueryHandler("orders.order.list")).toBeDefined();
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
    expect(registry.getSearchableFields("admin.user")).toEqual(["email", "lastName"]);
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
    expect(registry.getSortableFields("sortTest.item")).toEqual(["name", "rank"]);
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

  test("softDeleteDefault is true by default, configurable via softDelete", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("item", createEntity({ table: "Items", fields: { name: createTextField() } }));
    });

    const app1 = createApp({ roles: ["Admin"], features: [feature] });
    expect(app1.softDeleteDefault).toBe(true);

    const app2 = createApp({ roles: ["Admin"], features: [feature], softDelete: false });
    expect(app2.softDeleteDefault).toBe(false);
  });
});

// --- r.requires() ---

describe("r.requires()", () => {
  test("feature with satisfied dependency boots fine", () => {
    const config = defineFeature("config", () => {});
    const invoicing = defineFeature("invoicing", (r) => {
      r.requires("config");
    });

    expect(() => createRegistry([config, invoicing])).not.toThrow();
  });

  test("feature with missing dependency fails at boot", () => {
    const invoicing = defineFeature("invoicing", (r) => {
      r.requires("config");
    });

    expect(() => createRegistry([invoicing])).toThrow(
      /feature "invoicing" requires feature "config" which is not registered/i,
    );
  });

  test("multiple requires all validated", () => {
    const invoicing = defineFeature("invoicing", (r) => {
      r.requires("config", "files");
    });
    const config = defineFeature("config", () => {});

    expect(() => createRegistry([config, invoicing])).toThrow(
      /feature "invoicing" requires feature "files" which is not registered/i,
    );
  });

  test("requires stores dependency names on feature", () => {
    const feature = defineFeature("invoicing", (r) => {
      r.requires("config", "files");
    });

    expect(feature.requires).toEqual(["config", "files"]);
  });

  test("optionalRequires stores optional dependency names", () => {
    const feature = defineFeature("invoicing", (r) => {
      r.requires("config");
      r.optionalRequires("tags", "customFields");
    });

    expect(feature.requires).toEqual(["config"]);
    expect(feature.optionalRequires).toEqual(["tags", "customFields"]);
  });

  test("missing optionalRequires does not throw in registry", () => {
    const f1 = defineFeature("a", (r) => {
      r.optionalRequires("nonexistent");
    });

    // No error — optional dependency is not enforced
    expect(() => createRegistry([f1])).not.toThrow();
  });

  test("missing required feature still throws in registry", () => {
    const f1 = defineFeature("a", (r) => {
      r.requires("nonexistent");
    });

    expect(() => createRegistry([f1])).toThrow(/requires.*nonexistent/i);
  });
});

// --- r.config() ---

describe("r.config()", () => {
  test("registers config keys on feature", () => {
    const feature = defineFeature("invoicing", (r) => {
      r.config({
        keys: {
          defaultVat: {
            type: "number",
            default: 19,
            scope: "tenant",
            access: { write: ["Admin"], read: ["all"] },
          },
        },
      });
    });

    expect(feature.configKeys["defaultVat"]).toBeDefined();
    expect(feature.configKeys["defaultVat"]?.type).toBe("number");
    expect(feature.configKeys["defaultVat"]?.scope).toBe("tenant");
  });

  test("registry stores config keys with feature prefix", () => {
    const feature = defineFeature("invoicing", (r) => {
      r.config({
        keys: {
          defaultVat: {
            type: "number",
            default: 19,
            scope: "tenant",
            access: { write: ["Admin"], read: ["all"] },
          },
          showNetPrices: {
            type: "boolean",
            default: true,
            scope: "user",
            access: { write: ["all"], read: ["all"] },
          },
        },
      });
    });

    const registry = createRegistry([feature]);
    expect(registry.getConfigKey("invoicing.defaultVat")).toBeDefined();
    expect(registry.getConfigKey("invoicing.defaultVat")?.type).toBe("number");
    expect(registry.getConfigKey("invoicing.showNetPrices")?.scope).toBe("user");
    expect(registry.getConfigKey("nonexistent.key")).toBeUndefined();
  });

  test("getAllConfigKeys returns all keys across features", () => {
    const f1 = defineFeature("invoicing", (r) => {
      r.config({
        keys: {
          vat: {
            type: "number",
            default: 19,
            scope: "tenant",
            access: { write: ["Admin"], read: ["all"] },
          },
        },
      });
    });
    const f2 = defineFeature("notifications", (r) => {
      r.config({
        keys: {
          push: {
            type: "boolean",
            default: true,
            scope: "user",
            access: { write: ["all"], read: ["all"] },
          },
        },
      });
    });

    const registry = createRegistry([f1, f2]);
    const all = registry.getAllConfigKeys();
    expect(all.size).toBe(2);
    expect(all.has("invoicing.vat")).toBe(true);
    expect(all.has("notifications.push")).toBe(true);
  });

  test("throws on duplicate config key across features", () => {
    const f1 = defineFeature("a", (r) => {
      r.config({
        keys: {
          key1: { type: "text", scope: "system", access: { write: ["Admin"], read: ["all"] } },
        },
      });
    });
    // Same feature name = duplicate feature error (already tested)
    // Different feature name but same qualified key is impossible since prefix differs
    // So this test verifies the same feature can't register twice
    const f2 = defineFeature("a", (r) => {
      r.config({
        keys: {
          key1: { type: "text", scope: "system", access: { write: ["Admin"], read: ["all"] } },
        },
      });
    });

    expect(() => createRegistry([f1, f2])).toThrow(/duplicate feature/i);
  });

  test("encrypted config key is stored", () => {
    const feature = defineFeature("integration", (r) => {
      r.config({
        keys: {
          apiSecret: {
            type: "text",
            scope: "tenant",
            encrypted: true,
            access: { write: ["SystemAdmin"], read: ["SystemAdmin"] },
          },
        },
      });
    });

    const registry = createRegistry([feature]);
    expect(registry.getConfigKey("integration.apiSecret")?.encrypted).toBe(true);
  });

  test("createApp validates config key roles", () => {
    const feature = defineFeature("invoicing", (r) => {
      r.config({
        keys: {
          vat: {
            type: "number",
            default: 19,
            scope: "tenant",
            access: { write: ["FakeRole"], read: ["all"] },
          },
        },
      });
    });

    expect(() => createApp({ roles: ["Admin"] as const, features: [feature] })).toThrow(
      /unknown role.*FakeRole/i,
    );
  });

  test("createApp allows 'all' and 'system' as special roles", () => {
    const feature = defineFeature("invoicing", (r) => {
      r.config({
        keys: {
          vat: {
            type: "number",
            default: 19,
            scope: "tenant",
            access: { write: ["system"], read: ["all"] },
          },
        },
      });
    });

    expect(() => createApp({ roles: ["Admin"] as const, features: [feature] })).not.toThrow();
  });
});

// --- Relations ---

describe("r.relation()", () => {
  test("registers belongsTo relation", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "user",
        createEntity({ table: "Users", fields: { departmentId: createTextField() } }),
      );
      r.entity(
        "department",
        createEntity({ table: "Departments", fields: { name: createTextField() } }),
      );
      r.relation("user", "department", {
        type: "belongsTo",
        target: "test.department",
        foreignKey: "departmentId",
        searchInclude: ["name"],
      });
    });

    expect(feature.relations["user"]).toBeDefined();
    expect(feature.relations["user"]?.["department"]?.type).toBe("belongsTo");
  });

  test("registers manyToMany relation", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("user", createEntity({ table: "Users", fields: {} }));
      r.entity("role", createEntity({ table: "Roles", fields: { name: createTextField() } }));
      r.relation("user", "roles", {
        type: "manyToMany",
        target: "test.role",
        through: { table: "UserRoles", sourceKey: "userId", targetKey: "roleId" },
        searchInclude: ["name"],
      });
    });

    const rel = feature.relations["user"]?.["roles"];
    expect(rel?.type).toBe("manyToMany");
    if (rel?.type === "manyToMany") {
      expect(rel.through.table).toBe("UserRoles");
    }
  });

  test("registers hasMany relation", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("department", createEntity({ table: "Departments", fields: {} }));
      r.entity("user", createEntity({ table: "Users", fields: {} }));
      r.relation("department", "users", {
        type: "hasMany",
        target: "test.user",
        foreignKey: "departmentId",
      });
    });

    expect(feature.relations["department"]?.["users"]?.type).toBe("hasMany");
  });
});

describe("registry relations", () => {
  test("getRelations returns relations within same feature", () => {
    const f1 = defineFeature("users", (r) => {
      r.entity("user", createEntity({ table: "Users", fields: {} }));
      r.entity("role", createEntity({ table: "Roles", fields: { name: createTextField() } }));
      r.relation("user", "roles", {
        type: "manyToMany",
        target: "users.role",
        through: { table: "UserRoles", sourceKey: "userId", targetKey: "roleId" },
        searchInclude: ["name"],
      });
    });

    const registry = createRegistry([f1]);
    const rels = registry.getRelations("users.user");
    expect(rels["roles"]).toBeDefined();
  });

  test("getSearchIncludes returns fields to index from relations", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("user", createEntity({ table: "Users", fields: {} }));
      r.entity("role", createEntity({ table: "Roles", fields: { name: createTextField() } }));
      r.entity("department", createEntity({ table: "Depts", fields: { name: createTextField() } }));
      r.relation("user", "roles", {
        type: "manyToMany",
        target: "test.role",
        through: { table: "UserRoles", sourceKey: "userId", targetKey: "roleId" },
        searchInclude: ["name"],
      });
      r.relation("user", "department", {
        type: "belongsTo",
        target: "test.department",
        foreignKey: "departmentId",
        searchInclude: ["name"],
      });
    });

    const registry = createRegistry([feature]);
    const includes = registry.getSearchIncludes("test.user");
    expect(includes.get("roles")).toEqual(["name"]);
    expect(includes.get("department")).toEqual(["name"]);
  });

  test("throws on relation to non-existent entity", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("user", createEntity({ table: "Users", fields: {} }));
      r.relation("user", "ghost", {
        type: "belongsTo",
        target: "nonexistent",
        foreignKey: "ghostId",
      });
    });

    expect(() => createRegistry([feature])).toThrow(/nonexistent.*does not exist/i);
  });

  test("second relation with same name on same entity overwrites in feature definition", () => {
    // Within a single feature, the second r.relation() call overwrites the first
    const f1 = defineFeature("a", (r) => {
      r.entity("user", createEntity({ table: "Users", fields: {} }));
      r.entity("role", createEntity({ table: "Roles", fields: {} }));
      r.relation("user", "roles", {
        type: "manyToMany",
        target: "a.role",
        through: { table: "UR1", sourceKey: "userId", targetKey: "roleId" },
      });
      r.relation("user", "roles", {
        type: "manyToMany",
        target: "a.role",
        through: { table: "UR2", sourceKey: "userId", targetKey: "roleId" },
      });
    });

    const registry = createRegistry([f1]);
    const rels = registry.getRelations("a.user");
    // Last write wins
    expect((rels["roles"] as { through: { table: string } }).through.table).toBe("UR2");
  });
});

// --- Global Search (new tenant-based API) ---

describe("global search", () => {
  test("searches across entity types in same tenant", async () => {
    const { createInMemorySearchAdapter } = await import("../../search");
    const adapter = createInMemorySearchAdapter();
    await adapter.configure(1, { searchableFields: ["email", "name", "title"] });

    await adapter.index(1, {
      entityType: "user",
      entityId: 1,
      weight: 10,
      fields: { email: "marc@test.de", name: "Marc" },
    });
    await adapter.index(1, {
      entityType: "project",
      entityId: 10,
      weight: 5,
      fields: { title: "Marc's Project" },
    });

    const results = await adapter.search(1, "marc");
    expect(results).toHaveLength(2);
    expect(results[0]?.entityType).toBe("user"); // higher weight
    expect(results[1]?.entityType).toBe("project");
  });

  test("no filter = all types, filterType = one type", async () => {
    const { createInMemorySearchAdapter } = await import("../../search");
    const adapter = createInMemorySearchAdapter();
    await adapter.configure(1, { searchableFields: ["name"] });

    await adapter.index(1, {
      entityType: "user",
      entityId: 1,
      weight: 1,
      fields: { name: "Marc" },
    });
    await adapter.index(1, {
      entityType: "project",
      entityId: 10,
      weight: 1,
      fields: { name: "Kumiko" },
    });

    const all = await adapter.search(1, "marc");
    expect(all).toHaveLength(1);
    expect(all[0]?.entityType).toBe("user");

    const projects = await adapter.search(1, "kumiko", { filterType: "project" });
    expect(projects).toHaveLength(1);
    expect(projects[0]?.entityType).toBe("project");
  });
});
