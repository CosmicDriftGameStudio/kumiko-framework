import { describe, expect, test } from "vitest";
import { z } from "zod";
import { createTestUser } from "../../stack";
import { rolesOf } from "../../testing/access-assertions";
import { hasAccess } from "../access";
import { createSystemConfig, createTenantConfig, createUserConfig } from "../config-helpers";
import { defineQueryHandler, defineWriteHandler } from "../define-handler";
import {
  createBooleanField,
  createEmbeddedField,
  createEntity,
  createMoneyField,
  createSelectField,
  createTextField,
} from "../factories";
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
    const schema = z.object({ email: z.email() });

    const feature = defineFeature("test", (r) => {
      r.writeHandler(
        "user:invite",
        schema,
        async (event) => {
          // event.payload.email is inferred as string
          const _email: string = event.payload.email;
          return { isSuccess: true, data: { id: 1 } };
        },
        { access: { openToAll: true } },
      );
    });

    expect(feature.writeHandlers["user:invite"]).toBeDefined();
    expect(feature.writeHandlers["user:invite"]?.name).toBe("user:invite");
  });

  test("writeHandler returns typed HandlerRef", () => {
    let ref: { name: string } | undefined;
    defineFeature("test", (r) => {
      ref = r.writeHandler(
        "order:create",
        z.object({}),
        async () => ({
          isSuccess: true,
          data: null,
        }),
        { access: { openToAll: true } },
      );
    });
    expect(ref?.name).toBe("order:create");
  });

  test("queryHandler returns typed HandlerRef", () => {
    let ref: { name: string } | undefined;
    defineFeature("test", (r) => {
      ref = r.queryHandler("order:list", z.object({}), async () => [], {
        access: { openToAll: true },
      });
    });
    expect(ref?.name).toBe("order:list");
  });

  test("r.defineEvent returns typed EventDef and registers on feature", () => {
    let eventRef: { name: string } | undefined;
    const feature = defineFeature("orders", (r) => {
      eventRef = r.defineEvent("order:created", z.object({ orderId: z.number() }));
    });

    // E.3: defineEvent returns the fully-qualified name so callers can
    // pass it straight to ctx.appendEvent without building the qn manually.
    expect(eventRef?.name).toBe("orders:event:order:created");
    expect(feature.events["order:created"]).toBeDefined();
    expect(feature.events["order:created"]?.schema).toBeDefined();
    // The stored def carries the qualified name too (registry will confirm).
    expect(feature.events["order:created"]?.name).toBe("orders:event:order:created");
  });

  test("setup-callback return is exposed as feature.exports (cross-feature pull-down)", () => {
    const feature = defineFeature("invoicing", (r) => {
      const config = r.config({
        keys: {
          defaultVat: createTenantConfig("number", { default: 19 }),
        },
      });
      return { config };
    });
    // Type-narrow access — `feature.exports.config.defaultVat` is typed
    // through the defineFeature<TExports> generic; if the generic regressed
    // to void, .exports would be `unknown` and these reads wouldn't compile.
    expect(feature.exports.config.defaultVat.name).toBe("invoicing:config:default-vat");
    expect(feature.exports.config.defaultVat.type).toBe("number");
  });

  test("setup with no return leaves exports undefined", () => {
    const feature = defineFeature("noop", () => {});
    expect(feature.exports).toBeUndefined();
  });

  test("registry prefixes event names with feature name", () => {
    const feature = defineFeature("orders", (r) => {
      r.defineEvent("order:created", z.object({ orderId: z.number() }));
    });
    const registry = createRegistry([feature]);
    expect(registry.getEvent("orders:event:order:created")).toBeDefined();
    expect(registry.getEvent("order:created")).toBeUndefined();
  });

  test("collects write handlers via object form (defineWriteHandler)", () => {
    const handler = defineWriteHandler({
      name: "user:create",
      schema: z.object({ email: z.email() }),
      access: { roles: ["Admin"] },
      handler: async (event) => {
        return { isSuccess: true, data: { id: 1, email: event.payload.email } };
      },
    });

    const feature = defineFeature("test", (r) => {
      r.writeHandler(handler);
    });

    expect(feature.writeHandlers["user:create"]).toBeDefined();
    expect(feature.writeHandlers["user:create"]?.name).toBe("user:create");
    expect(rolesOf(feature.writeHandlers["user:create"]?.access)).toEqual(["Admin"]);
  });

  test("collects query handlers with inferred types", () => {
    const schema = z.object({ userId: z.number() });

    const feature = defineFeature("test", (r) => {
      r.queryHandler(
        "user:detail",
        schema,
        async (query) => {
          const _id: number = query.payload.userId;
          return { id: _id, email: "test@test.de" };
        },
        { access: { openToAll: true } },
      );
    });

    expect(feature.queryHandlers["user:detail"]).toBeDefined();
  });

  test("collects query handlers via object form (defineQueryHandler)", () => {
    const handler = defineQueryHandler({
      name: "user:list",
      schema: z.object({ limit: z.number().optional() }),
      handler: async () => {
        return [{ id: 1, email: "test@test.de" }];
      },
      access: { openToAll: true },
    });

    const feature = defineFeature("test", (r) => {
      r.queryHandler(handler);
    });

    expect(feature.queryHandlers["user:list"]).toBeDefined();
    expect(feature.queryHandlers["user:list"]?.name).toBe("user:list");
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
        "user:invite",
        z.object({ email: z.string() }),
        async () => ({ isSuccess: true, data: null }),
        { access: { roles: ["Admin", "SystemAdmin"] } },
      );
    });

    expect(rolesOf(feature.writeHandlers["user:invite"]?.access)).toEqual(["Admin", "SystemAdmin"]);
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
      r.writeHandler("user:invite", z.object({}), async () => ({ isSuccess: true, data: null }), {
        access: { openToAll: true },
      });
    });
    const f2 = defineFeature("profile", (r) => {
      r.queryHandler("profile:me", z.object({}), async () => ({ id: 1 }), {
        access: { openToAll: true },
      });
    });

    const registry = createRegistry([f1, f2]);
    expect(registry.getWriteHandler("admin:write:user:invite")).toBeDefined();
    expect(registry.getQueryHandler("profile:query:profile:me")).toBeDefined();
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

  test("duplicate entity name across features throws", () => {
    const f1 = defineFeature("a", (r) => {
      r.entity("user", createEntity({ table: "Users", fields: {} }));
    });
    const f2 = defineFeature("b", (r) => {
      r.entity("user", createEntity({ table: "Users2", fields: {} }));
    });

    expect(() => createRegistry([f1, f2])).toThrow(/duplicate entity.*user/i);
  });

  test("different features can have same handler short name (prefixed differently)", () => {
    const f1 = defineFeature("a", (r) => {
      r.writeHandler("user:invite", z.object({}), async () => ({ isSuccess: true, data: null }), {
        access: { openToAll: true },
      });
    });
    const f2 = defineFeature("b", (r) => {
      r.writeHandler("user:invite", z.object({}), async () => ({ isSuccess: true, data: null }), {
        access: { openToAll: true },
      });
    });

    // No error — "a:write:user:invite" and "b:write:user:invite" are distinct
    const registry = createRegistry([f1, f2]);
    expect(registry.getWriteHandler("a:write:user:invite")).toBeDefined();
    expect(registry.getWriteHandler("b:write:user:invite")).toBeDefined();
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

  test("throws when write handler is not entity-mapped in feature with field-access", () => {
    const feature = defineFeature("hr", (r) => {
      r.entity(
        "employee",
        createEntity({
          table: "employees",
          fields: {
            name: createTextField(),
            salary: createTextField({ access: { write: ["Admin"] } }),
          },
        }),
      );
      // Handler name "promote" has no entity prefix → can't be mapped
      r.writeHandler("promote", z.object({}), async () => ({ isSuccess: true, data: null }), {
        access: { openToAll: true },
      });
    });

    expect(() => createRegistry([feature])).toThrow(/hr:write:promote.*not mapped.*entity:action/i);
  });

  test("allows unmapped write handlers when feature has no field-access rules", () => {
    const feature = defineFeature("admin", (r) => {
      r.entity("setting", createEntity({ table: "settings", fields: { key: createTextField() } }));
      // No field-access rules on entity → "reset" without entity prefix is fine
      r.writeHandler("reset", z.object({}), async () => ({ isSuccess: true, data: null }), {
        access: { openToAll: true },
      });
    });

    expect(() => createRegistry([feature])).not.toThrow();
  });

  test("entity-mapped handlers pass validation with field-access", () => {
    const feature = defineFeature("hr", (r) => {
      r.entity(
        "employee",
        createEntity({
          table: "employees",
          fields: {
            name: createTextField(),
            salary: createTextField({ access: { write: ["Admin"] } }),
          },
        }),
      );
      // "employee:promote" follows convention → mapped to entity "employee"
      r.writeHandler(
        "employee:promote",
        z.object({}),
        async () => ({
          isSuccess: true,
          data: null,
        }),
        { access: { openToAll: true } },
      );
    });

    expect(() => createRegistry([feature])).not.toThrow();
  });

  test("throws when dotted query handler references unknown entity (typo protection)", () => {
    const feature = defineFeature("hr", (r) => {
      r.entity(
        "employee",
        createEntity({
          table: "employees",
          fields: {
            salary: createTextField({ access: { read: ["Admin"] } }),
          },
        }),
      );
      r.writeHandler(
        "employee:create",
        z.object({}),
        async () => ({
          isSuccess: true,
          data: null,
        }),
        { access: { openToAll: true } },
      );
      // Typo: "emp" instead of "employee"
      r.queryHandler("emp:list", z.object({}), async () => [], { access: { openToAll: true } });
    });

    expect(() => createRegistry([feature])).toThrow(/emp:list.*entity-bound.*no matching entity/i);
  });

  test("allows standalone query handlers without dot in features with field-access", () => {
    const feature = defineFeature("hr", (r) => {
      r.entity(
        "employee",
        createEntity({
          table: "employees",
          fields: {
            salary: createTextField({ access: { read: ["Admin"] } }),
          },
        }),
      );
      r.writeHandler(
        "employee:create",
        z.object({}),
        async () => ({
          isSuccess: true,
          data: null,
        }),
        { access: { openToAll: true } },
      );
      // Standalone queries — no dot, intentionally not entity-bound
      r.queryHandler("dashboard", z.object({}), async () => ({ total: 42 }), {
        access: { openToAll: true },
      });
      r.queryHandler("orgChart", z.object({}), async () => [], { access: { openToAll: true } });
    });

    expect(() => createRegistry([feature])).not.toThrow();
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
    // Empty required-roles list denies everyone under default-deny.
    { userRoles: ["Admin"], requiredRoles: [], expected: false },
  ])("user $userRoles vs required $requiredRoles → $expected", ({
    userRoles,
    requiredRoles,
    expected,
  }) => {
    const user = createTestUser({ roles: userRoles });
    expect(hasAccess(user, { roles: requiredRoles })).toBe(expected);
  });

  test("missing access rule denies access (default-deny)", () => {
    const user = createTestUser({ roles: ["Employee"] });
    expect(hasAccess(user, undefined)).toBe(false);
  });

  test("openToAll grants access to any authenticated user", () => {
    const user = createTestUser({ roles: ["Employee"] });
    expect(hasAccess(user, { openToAll: true })).toBe(true);
  });

  test("openToAll grants access even to user with no roles", () => {
    const user = createTestUser({ roles: [] });
    expect(hasAccess(user, { openToAll: true })).toBe(true);
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

  test("softDeleteDefault is true by default, configurable via softDelete", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("item", createEntity({ table: "Items", fields: { name: createTextField() } }));
    });

    const app1 = createApp({ roles: ["Admin"], features: [feature] });
    expect(app1.softDeleteDefault).toBe(true);

    const app2 = createApp({ roles: ["Admin"], features: [feature], softDelete: false });
    expect(app2.softDeleteDefault).toBe(false);
  });

  test("currencies includes defaults and custom additions", () => {
    const feature = defineFeature("test", () => {});
    const app = createApp({
      roles: ["Admin"],
      features: [feature],
      currencies: ["BHD", "SAR"],
    });
    expect(app.currencies).toContain("EUR");
    expect(app.currencies).toContain("BHD");
    expect(app.currencies).toContain("SAR");
  });

  test("rejects money field without defaultCurrency on entity", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "invoice",
        createEntity({
          table: "Invoices",
          fields: { total: createMoneyField({ required: true }) },
        }),
      );
    });
    expect(() => createApp({ roles: ["Admin"], features: [feature] })).toThrow(
      "has money fields but no defaultCurrency",
    );
  });

  test("rejects unknown defaultCurrency", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "invoice",
        createEntity({
          table: "Invoices",
          fields: { total: createMoneyField() },
          defaultCurrency: "FAKE",
        }),
      );
    });
    expect(() => createApp({ roles: ["Admin"], features: [feature] })).toThrow(
      'defaultCurrency "FAKE" which is not in the currencies list',
    );
  });

  test("accepts money field with valid defaultCurrency", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "invoice",
        createEntity({
          table: "Invoices",
          fields: { total: createMoneyField({ required: true }) },
          defaultCurrency: "EUR",
        }),
      );
    });
    expect(() => createApp({ roles: ["Admin"], features: [feature] })).not.toThrow();
  });

  test("accepts custom currency when added to app config", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "invoice",
        createEntity({
          table: "Invoices",
          fields: { total: createMoneyField() },
          defaultCurrency: "BHD",
        }),
      );
    });
    expect(() =>
      createApp({ roles: ["Admin"], features: [feature], currencies: ["BHD"] }),
    ).not.toThrow();
  });

  test("rejects embedded field with empty schema", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "doc",
        createEntity({
          table: "Docs",
          fields: {
            // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
            meta: createEmbeddedField({} as any),
          },
        }),
      );
    });
    expect(() => createApp({ roles: ["Admin"], features: [feature] })).toThrow("empty schema");
  });

  test("rejects embedded sub-field with invalid type", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "doc",
        createEntity({
          table: "Docs",
          fields: {
            address: createEmbeddedField({
              // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
              street: { type: "embedded" as any },
            }),
          },
        }),
      );
    });
    expect(() => createApp({ roles: ["Admin"], features: [feature] })).toThrow(
      'invalid type "embedded"',
    );
  });

  test("rejects embedded sub-field with unknown type", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "doc",
        createEntity({
          table: "Docs",
          fields: {
            address: createEmbeddedField({
              // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
              street: { type: "money" as any },
            }),
          },
        }),
      );
    });
    expect(() => createApp({ roles: ["Admin"], features: [feature] })).toThrow(
      'invalid type "money"',
    );
  });

  test("accepts valid embedded field with all sub-field types", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "doc",
        createEntity({
          table: "Docs",
          fields: {
            meta: createEmbeddedField({
              label: { type: "text", required: true },
              count: { type: "number" },
              active: { type: "boolean" },
              created: { type: "date" },
            }),
          },
        }),
      );
    });
    expect(() => createApp({ roles: ["Admin"], features: [feature] })).not.toThrow();
  });

  test("rejects transitions on non-select field", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "doc",
        createEntity({
          table: "Docs",
          fields: { title: createTextField() },
          transitions: {
            title: { a: ["b"] },
          },
        }),
      );
    });
    expect(() => createApp({ roles: ["Admin"], features: [feature] })).toThrow(
      'type is "text" (must be "select")',
    );
  });

  test("rejects transitions with unknown state", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "invoice",
        createEntity({
          table: "Invoices",
          fields: {
            status: createSelectField({ options: ["draft", "sent", "paid"] as const }),
          },
          transitions: {
            status: {
              draft: ["sent"],
              sent: ["paid"],
              paid: ["unknown_state"],
            },
          },
        }),
      );
    });
    expect(() => createApp({ roles: ["Admin"], features: [feature] })).toThrow('"unknown_state"');
  });

  test("rejects transitions for unknown field", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "doc",
        createEntity({
          table: "Docs",
          fields: { title: createTextField() },
          transitions: {
            nonExistent: { a: ["b"] },
          },
        }),
      );
    });
    expect(() => createApp({ roles: ["Admin"], features: [feature] })).toThrow(
      'unknown field "nonExistent"',
    );
  });

  test("accepts valid transitions matching select options", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "invoice",
        createEntity({
          table: "Invoices",
          fields: {
            status: createSelectField({
              options: ["draft", "sent", "paid", "cancelled"] as const,
            }),
          },
          transitions: {
            status: {
              draft: ["sent"],
              sent: ["paid", "cancelled"],
              paid: [],
              cancelled: [],
            },
          },
        }),
      );
    });
    expect(() => createApp({ roles: ["Admin"], features: [feature] })).not.toThrow();
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
    expect(registry.getConfigKey("invoicing:config:default-vat")).toBeDefined();
    expect(registry.getConfigKey("invoicing:config:default-vat")?.type).toBe("number");
    expect(registry.getConfigKey("invoicing:config:show-net-prices")?.scope).toBe("user");
    expect(registry.getConfigKey("nonexistent:config:key")).toBeUndefined();
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
    expect(all.has("invoicing:config:vat")).toBe(true);
    expect(all.has("notifications:config:push")).toBe(true);
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
    expect(registry.getConfigKey("integration:config:api-secret")?.encrypted).toBe(true);
  });

  test("returns typed handles with qualified names", () => {
    // Capture in the setup closure — that's where the generic resolves
    // to the literal key shape.
    let handles!: {
      readonly defaultVat: { readonly name: string; readonly type: "number" };
      readonly showNetPrices: { readonly name: string; readonly type: "boolean" };
    };
    defineFeature("invoicing", (r) => {
      handles = r.config({
        keys: {
          defaultVat: createTenantConfig("number", { default: 19 }),
          showNetPrices: createUserConfig("boolean", { default: true }),
        },
      });
    });

    expect(handles.defaultVat.name).toBe("invoicing:config:default-vat");
    expect(handles.defaultVat.type).toBe("number");
    expect(handles.showNetPrices.name).toBe("invoicing:config:show-net-prices");
    expect(handles.showNetPrices.type).toBe("boolean");
  });

  test("camelCase feature + key are kebab-cased in the handle name", () => {
    let handles!: { readonly monthlyTotalCents: { readonly name: string } };
    defineFeature("billingCore", (r) => {
      handles = r.config({
        keys: {
          monthlyTotalCents: createSystemConfig("number", { default: 0 }),
        },
      });
    });
    expect(handles.monthlyTotalCents.name).toBe("billing-core:config:monthly-total-cents");
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
        target: "department",
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
        target: "role",
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
        target: "user",
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
        target: "role",
        through: { table: "UserRoles", sourceKey: "userId", targetKey: "roleId" },
        searchInclude: ["name"],
      });
    });

    const registry = createRegistry([f1]);
    const rels = registry.getRelations("user");
    expect(rels["roles"]).toBeDefined();
  });

  test("getSearchIncludes returns fields to index from relations", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("user", createEntity({ table: "Users", fields: {} }));
      r.entity("role", createEntity({ table: "Roles", fields: { name: createTextField() } }));
      r.entity("department", createEntity({ table: "Depts", fields: { name: createTextField() } }));
      r.relation("user", "roles", {
        type: "manyToMany",
        target: "role",
        through: { table: "UserRoles", sourceKey: "userId", targetKey: "roleId" },
        searchInclude: ["name"],
      });
      r.relation("user", "department", {
        type: "belongsTo",
        target: "department",
        foreignKey: "departmentId",
        searchInclude: ["name"],
      });
    });

    const registry = createRegistry([feature]);
    const includes = registry.getSearchIncludes("user");
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
        target: "role",
        through: { table: "UR1", sourceKey: "userId", targetKey: "roleId" },
      });
      r.relation("user", "roles", {
        type: "manyToMany",
        target: "role",
        through: { table: "UR2", sourceKey: "userId", targetKey: "roleId" },
      });
    });

    const registry = createRegistry([f1]);
    const rels = registry.getRelations("user");
    // Last write wins
    expect((rels["roles"] as { through: { table: string } }).through.table).toBe("UR2");
  });
});

// --- Global Search (new tenant-based API) ---

describe("global search", () => {
  test("searches across entity types in same tenant", async () => {
    const { createInMemorySearchAdapter } = await import("../../search");
    const adapter = createInMemorySearchAdapter();
    await adapter.configure("00000000-0000-4000-8000-000000000001", {
      searchableFields: ["email", "name", "title"],
    });

    await adapter.index("00000000-0000-4000-8000-000000000001", {
      entityType: "user",
      entityId: 1,
      weight: 10,
      fields: { email: "marc@test.de", name: "Marc" },
    });
    await adapter.index("00000000-0000-4000-8000-000000000001", {
      entityType: "project",
      entityId: 10,
      weight: 5,
      fields: { title: "Marc's Project" },
    });

    const results = await adapter.search("00000000-0000-4000-8000-000000000001", "marc");
    expect(results).toHaveLength(2);
    expect(results[0]?.entityType).toBe("user"); // higher weight
    expect(results[1]?.entityType).toBe("project");
  });

  test("no filter = all types, filterType = one type", async () => {
    const { createInMemorySearchAdapter } = await import("../../search");
    const adapter = createInMemorySearchAdapter();
    await adapter.configure("00000000-0000-4000-8000-000000000001", { searchableFields: ["name"] });

    await adapter.index("00000000-0000-4000-8000-000000000001", {
      entityType: "user",
      entityId: 1,
      weight: 1,
      fields: { name: "Marc" },
    });
    await adapter.index("00000000-0000-4000-8000-000000000001", {
      entityType: "project",
      entityId: 10,
      weight: 1,
      fields: { name: "Kumiko" },
    });

    const all = await adapter.search("00000000-0000-4000-8000-000000000001", "marc");
    expect(all).toHaveLength(1);
    expect(all[0]?.entityType).toBe("user");

    const projects = await adapter.search("00000000-0000-4000-8000-000000000001", "kumiko", {
      filterType: "project",
    });
    expect(projects).toHaveLength(1);
    expect(projects[0]?.entityType).toBe("project");
  });
});

// --- Boot Validation: dangling references ---

describe("registry boot validation", () => {
  test("throws for lifecycle hook targeting non-existent handler", () => {
    const feature = defineFeature("test", (r) => {
      r.hook("postSave", "nonexistent.handler", async () => {});
    });

    expect(() => createRegistry([feature])).toThrow(/postSave.*nonexistent.*never fire/i);
  });

  test("throws for job event trigger targeting non-existent handler", () => {
    const feature = defineFeature("test", (r) => {
      r.job("myJob", { trigger: { on: "ghost-handler" } }, async () => {});
    });

    expect(() => createRegistry([feature])).toThrow(/my-job.*ghost-handler.*no handler/i);
  });

  test("multi-trigger: r.job akzeptiert ein Array von Trigger-Refs", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity("order", createEntity({ table: "Orders", fields: {} }));
      r.writeHandler("order:create", z.object({}), async () => ({ isSuccess: true, data: null }), {
        access: { openToAll: true },
      });
      r.writeHandler("order:cancel", z.object({}), async () => ({ isSuccess: true, data: null }), {
        access: { openToAll: true },
      });
      // Ein Job-Body, zwei Trigger — DRY-Pattern für Fanout-Cases.
      r.job(
        "fanout",
        { trigger: { on: ["shop:write:order:create", "shop:write:order:cancel"] } },
        async () => {},
      );
    });
    const registry = createRegistry([feature]);
    const job = registry.getJob("shop:job:fanout");
    expect(job).toBeDefined();
    if (job && "on" in job.trigger) {
      expect(job.trigger.on).toEqual(["shop:write:order:create", "shop:write:order:cancel"]);
    }
  });

  test("multi-trigger: einer der Targets fehlt → Boot-Reject", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity("order", createEntity({ table: "Orders", fields: {} }));
      r.writeHandler("order:create", z.object({}), async () => ({ isSuccess: true, data: null }), {
        access: { openToAll: true },
      });
      // create existiert, cancel nicht — zweiter Trigger ist Geist
      r.job(
        "fanout",
        { trigger: { on: ["shop:write:order:create", "shop:write:order:ghost"] } },
        async () => {},
      );
    });
    expect(() => createRegistry([feature])).toThrow(/fanout.*ghost.*no handler/i);
  });

  test("throws for extension usage referencing non-existent extension", () => {
    const feature = defineFeature("test", (r) => {
      r.useExtension("nonexistent", "user");
    });

    expect(() => createRegistry([feature])).toThrow(/nonexistent.*does not exist/i);
  });

  test("allows valid hook targets", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("item", createEntity({ table: "Items", fields: {} }));
      r.writeHandler("item.create", z.object({}), async () => ({ isSuccess: true, data: null }), {
        access: { openToAll: true },
      });
      r.hook("postSave", "item.create", async () => {});
    });

    expect(() => createRegistry([feature])).not.toThrow();
  });

  test("allows cron and manual job triggers (no handler reference)", () => {
    const feature = defineFeature("test", (r) => {
      r.job("cleanup", { trigger: { cron: "0 * * * *" } }, async () => {});
      r.job("sync", { trigger: { manual: true } }, async () => {});
    });

    expect(() => createRegistry([feature])).not.toThrow();
  });

  test("runIn flows through r.job into the registry", () => {
    const feature = defineFeature("test", (r) => {
      r.job("cleanup-api", { trigger: { manual: true }, runIn: "api" }, async () => {});
      r.job("cleanup-worker", { trigger: { manual: true }, runIn: "worker" }, async () => {});
      r.job("cleanup-default", { trigger: { manual: true } }, async () => {});
    });

    const registry = createRegistry([feature]);
    const jobs = registry.getAllJobs();
    expect(jobs.get("test:job:cleanup-api")?.runIn).toBe("api");
    expect(jobs.get("test:job:cleanup-worker")?.runIn).toBe("worker");
    // Omitted runIn stays undefined in the registry — the consumer (JobRunner)
    // resolves the default to "worker" at dispatch time, not at registration.
    expect(jobs.get("test:job:cleanup-default")?.runIn).toBeUndefined();
  });

  test("registry rejects job runIn='both' (Lane-Queue would over-dispatch)", () => {
    // TS-level JobRunIn = Exclude<RunIn, "both"> already rejects this; the
    // runtime guard exists for config-driven or cast-through paths.
    const feature = defineFeature("test", (r) => {
      r.job(
        "bad",
        { trigger: { manual: true }, runIn: "both" as unknown as "api" | "worker" },
        async () => {},
      );
    });

    expect(() => createRegistry([feature])).toThrow(
      /runIn "both".*must be pinned to a single lane/i,
    );
  });

  test("registry rejects MSP runIn with an unknown literal", () => {
    const feature = defineFeature("test", (r) => {
      r.multiStreamProjection({
        name: "msp",
        runIn: "everywhere" as unknown as "api",
        // defineFeature refuses an empty apply-map, so declare a dummy event
        // handler — the test is about the runIn-literal guard in registry.ts,
        // not about MSP-empty-apply.
        apply: { "some:event": async () => {} },
      });
    });

    expect(() => createRegistry([feature])).toThrow(/invalid runIn "everywhere"/i);
  });
});
