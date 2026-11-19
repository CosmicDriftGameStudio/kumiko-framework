import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { createTenantConfig } from "../config-helpers.ts";
import { defineFeature, type FeatureRegistrar } from "../index.ts";

// The renderer of feature-ast emits the object form; these tests execute the registrar runtime
// that unpacks it into feature state (the types alone prove nothing about the state written).

describe("registrar object form registers what it declares", () => {
  test("requires: { features } lands the feature names in order", () => {
    const feature = defineFeature("a", (r) => {
      r.requires({ features: ["auth", "tenant"] });
    });
    expect(feature.requires).toEqual(["auth", "tenant"]);
  });

  test("requires: a misspelled key is rejected instead of dropped", () => {
    expect(() =>
      defineFeature("legacy", (r) => {
        Reflect.apply(r.requires, r, [{ feature: ["auth"] }]);
      }),
    ).toThrow("[Feature legacy] r.requires() needs { features: string[] }");
  });

  test("optionalRequires: { features } lands the feature names", () => {
    const feature = defineFeature("a", (r) => {
      r.optionalRequires({ features: ["promotions"] });
    });
    expect(feature.optionalRequires).toEqual(["promotions"]);
  });

  test("readsConfig: { keys } lands the keys", () => {
    const feature = defineFeature("a", (r) => {
      r.readsConfig({ keys: ["auth.smtpHost"] });
    });
    expect(feature.configReads).toEqual(["auth.smtpHost"]);
  });

  test("entity: the definition keeps its name and registers under it", () => {
    const definition = {
      name: "item",
      fields: {
        title: {
          type: "text" as const,
          required: true,
          allowPlaintext: "test fixture value, not personal data",
        },
      },
    };
    const feature = defineFeature("a", (r) => {
      r.entity(definition);
    });
    expect(feature.entities?.["item"]).toEqual(definition);
  });

  test("entity: backingTable lands in entityTables, not in the entity definition", () => {
    const table = { sentinel: "drizzle table" };
    const feature = defineFeature("a", (r) => {
      r.entity({ name: "item", fields: {}, backingTable: table });
    });
    expect(feature.entityTables?.["item"]).toBe(table);
    expect(feature.entities?.["item"]).not.toHaveProperty("backingTable");
  });

  test("entity: without backingTable no entityTables entry exists", () => {
    const feature = defineFeature("a", (r) => {
      r.entity({ name: "item", fields: {} });
    });
    expect(feature.entityTables?.["item"]).toBeUndefined();
  });

  test("metric: registers under the short name with its options", () => {
    const feature = defineFeature("a", (r) => {
      r.metric({ name: "created", type: "counter" });
    });
    expect(feature.metrics?.["created"]).toMatchObject({ shortName: "created", type: "counter" });
  });

  test("secret: registers the qualified name and options", () => {
    const feature = defineFeature("stripe", (r) => {
      r.secret({ name: "apiKey", label: { en: "Stripe API Key" }, scope: "tenant" });
    });
    expect(feature.secretKeys["apiKey"]).toMatchObject({
      shortName: "apiKey",
      scope: "tenant",
    });
  });

  test("secret: an empty writeRoles list is rejected at declaration", () => {
    expect(() =>
      defineFeature("stripe", (r) => {
        r.secret({
          name: "apiKey",
          label: { en: "Stripe API Key" },
          scope: "tenant",
          writeRoles: [],
        });
      }),
    ).toThrow(/\[Feature stripe\] Secret "apiKey" declares an empty writeRoles list/);
  });

  test("secret: a non-empty writeRoles list is kept on the key definition", () => {
    const feature = defineFeature("stripe", (r) => {
      r.secret({
        name: "apiKey",
        label: { en: "Stripe API Key" },
        scope: "tenant",
        writeRoles: ["SystemAdmin"],
      });
    });
    expect(feature.secretKeys["apiKey"]?.writeRoles).toEqual(["SystemAdmin"]);
  });

  test("secretNamespace: derives the prefix from the feature and the name", () => {
    const feature = defineFeature("step-dispatcher", (r) => {
      r.secretNamespace({ name: "webhook-auth", label: { en: "Hook tokens" }, scope: "tenant" });
    });
    expect(feature.secretNamespaces["webhook-auth"]?.qualifiedPrefix).toBe(
      "step-dispatcher:webhook-auth.",
    );
  });

  test("secretNamespace: a duplicate name within a feature throws", () => {
    expect(() =>
      defineFeature("stripe", (r) => {
        r.secretNamespace({ name: "hooks", label: { en: "Hooks" }, scope: "tenant" });
        r.secretNamespace({ name: "hooks", label: { en: "Hooks" }, scope: "tenant" });
      }),
    ).toThrow(/\[Feature stripe\] Secret namespace "hooks" already registered/);
  });

  test("secretNamespace: an empty writeRoles list is rejected at declaration", () => {
    expect(() =>
      defineFeature("stripe", (r) => {
        r.secretNamespace({
          name: "hooks",
          label: { en: "Hooks" },
          scope: "tenant",
          writeRoles: [],
        });
      }),
    ).toThrow(/\[Feature stripe\] Secret namespace "hooks" declares an empty writeRoles list/);
  });

  test("relation: { entity, name, ...def } registers under the entity", () => {
    const definition = { type: "belongsTo" as const, target: "user", foreignKey: "supplierId" };
    const feature = defineFeature("a", (r) => {
      r.entity({ name: "item", fields: {} });
      r.relation({ entity: "item", name: "supplier", ...definition });
    });
    expect(feature.relations?.["item"]?.["supplier"]).toEqual(definition);
  });

  test("referenceData: { entity, data, upsertKey } registers the rows", () => {
    const data = [{ id: "a", label: "A" }];
    const feature = defineFeature("a", (r) => {
      r.referenceData({ entity: "category", data, upsertKey: "id" });
    });
    expect(feature.referenceData).toEqual([{ entityName: "category", data, upsertKey: "id" }]);
  });

  test("applyExtension: { name, entity, ...opts } registers the usage", () => {
    const feature = defineFeature("a", (r) => {
      r.applyExtension({ name: "audit-log", entity: "item", verbose: true });
    });
    expect(feature.extensionUsages).toEqual([
      { extensionName: "audit-log", entityName: "item", options: { verbose: true } },
    ]);
  });

  test("claimKey: registers the key with its type", () => {
    const feature = defineFeature("drivers", (r) => {
      r.claimKey({ name: "teamId", type: "string" });
    });
    expect(feature.claimKeys["teamId"]).toMatchObject({ shortName: "teamId", type: "string" });
  });

  test("job: the definition object registers name, trigger and handler", () => {
    const handler = async () => {};
    const feature = defineFeature("a", (r) => {
      r.job({ name: "reconcile", trigger: { manual: true }, handler });
    });
    expect(feature.jobs?.["reconcile"]).toMatchObject({
      name: "reconcile",
      trigger: { manual: true },
      handler,
    });
  });

  test("notification: the definition object registers under its name", () => {
    const recipient = () => null;
    const data = () => ({});
    const feature = defineFeature("a", (r) => {
      r.notification({ name: "itemLowStock", trigger: { on: "item:lowStock" }, recipient, data });
    });
    expect(feature.notifications?.["itemLowStock"]).toMatchObject({
      name: "itemLowStock",
      trigger: { on: "item:lowStock" },
    });
  });

  test("config: { keys } returns one handle per key", () => {
    const feature = defineFeature("a", (r) => {
      const handles = r.config({ keys: { limit: createTenantConfig("number") } });
      expect(handles.limit.name).toBe("a:config:limit");
    });
    expect(feature.configKeys?.["limit"]).toMatchObject({ type: "number" });
  });
});

// The static types reject positional calls, so the runtime check is reached through
// Reflect.apply, like untyped JS callers or stale generated code would reach it.
describe("registrar — a positional call fails at registration", () => {
  const schema = z.object({});
  const handler = async () => ({ isSuccess: true as const, data: {} });
  const access = { openToAll: { reason: "test" } } as const;

  const positionalCalls: ReadonlyArray<{
    readonly method: string;
    readonly call: (r: FeatureRegistrar) => unknown;
  }> = [
    {
      method: "writeHandler",
      call: (r) => Reflect.apply(r.writeHandler, r, ["x", schema, handler, { access }]),
    },
    {
      method: "queryHandler",
      call: (r) => Reflect.apply(r.queryHandler, r, ["x", schema, handler, { access }]),
    },
    {
      method: "entity",
      call: (r) => Reflect.apply(r.entity, r, ["item", { fields: {} }]),
    },
    {
      method: "requires",
      call: (r) => Reflect.apply(r.requires, r, ["auth"]),
    },
    {
      method: "hook",
      call: (r) => Reflect.apply(r.hook, r, ["postSave", "item", () => {}]),
    },
    {
      method: "defineWebhookEvent",
      call: (r) => Reflect.apply(r.defineWebhookEvent, r, ["item.created", {}]),
    },
  ];

  test("r.requires rejects extra arguments instead of dropping them", () => {
    expect(() =>
      defineFeature("legacy", (r) => {
        Reflect.apply(r.requires, r, [{ features: ["a"] }, { features: ["b"] }]);
      }),
    ).toThrow("[Feature legacy] r.requires() takes one options object");
  });

  for (const { method, call } of positionalCalls) {
    test(`r.${method}: a positional call throws instead of registering`, () => {
      expect(() =>
        defineFeature("legacy", (r) => {
          call(r);
        }),
      ).toThrow(`[Feature legacy] r.${method}() takes one options object`);
    });
  }
});

describe("registrar — hook definitions are checked by the type system", () => {
  test("a validation hook rejects escapeHatch", () => {
    expect(() =>
      defineFeature("types", (r) => {
        r.hook({
          type: "validation",
          target: "item",
          handler: () => null,
          // @ts-expect-error validation hooks have no escapeHatch
          escapeHatch: { reason: "not allowed here", grants: ["systemIdentity"] },
        });
      }),
    ).toThrow(/does not accept escapeHatch/);
  });

  test("a preDelete hook rejects phase", () => {
    // The type is the only barrier here: the registrar itself does not inspect `phase`.
    expect(() =>
      defineFeature("types", (r) => {
        r.hook({
          type: "preDelete",
          target: "item",
          handler: async () => {},
          // @ts-expect-error only post hooks (postSave, postDelete, postQuery) take a phase
          phase: "before",
        });
      }),
    ).not.toThrow();
  });

  test("a preSave hook rejects an { allOf } target", () => {
    expect(() =>
      defineFeature("types", (r) => {
        r.hook({
          type: "preSave",
          // @ts-expect-error preSave needs a concrete handler target, not { allOf }
          target: { allOf: "item" },
          handler: async (changes) => changes,
        });
      }),
    ).toThrow(/only supports postSave\/preDelete\/postDelete\/postQuery/);
  });
});
