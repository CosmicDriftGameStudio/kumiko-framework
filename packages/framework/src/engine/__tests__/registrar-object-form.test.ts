import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { defineFeature, type FeatureRegistrar } from "../index.ts";

// Object-Form is the shape the feature-ast renderer emits for Designer/
// AI-generated code (`r.entity({ name: "item", ... })` instead of
// `r.entity("item", { ... })`). The compile
// checks in feature-ast/__tests__/render-roundtrip.test.ts prove the TYPES
// line up; they never execute the runtime dispatch that unpacks Object-Form
// back into the same state mutations as the positional form. These tests
// cover that: one per distinct dispatch shape, asserting object-form and
// positional-form produce identical FeatureDefinition state.

describe("registrar Object-Form — runtime parity with positional form", () => {
  test("requires: array-unwrap ({ features }) lands the feature names in order", () => {
    const feature = defineFeature("a", (r) => {
      r.requires({ features: ["auth", "tenant"] });
    });
    expect(feature.requires).toEqual(["auth", "tenant"]);
  });

  test("optionalRequires: array-unwrap matches variadic-string form", () => {
    const positional = defineFeature("a", (r) => {
      r.optionalRequires("promotions");
    });
    const objectForm = defineFeature("b", (r) => {
      r.optionalRequires({ features: ["promotions"] });
    });
    expect(objectForm.optionalRequires).toEqual(positional.optionalRequires);
  });

  test("readsConfig: array-unwrap ({ keys }) matches variadic-string form", () => {
    const positional = defineFeature("a", (r) => {
      r.readsConfig("auth.smtpHost");
    });
    const objectForm = defineFeature("b", (r) => {
      r.readsConfig({ keys: ["auth.smtpHost"] });
    });
    expect(objectForm.configReads).toEqual(positional.configReads);
  });

  test("entity: split-name ({ name, ...fields }) registers the definition without the name key", () => {
    const definition = {
      fields: {
        title: {
          type: "text" as const,
          required: true,
          allowPlaintext: "test fixture value, not personal data",
        },
      },
    };
    const feature = defineFeature("a", (r) => {
      r.entity({ name: "item", ...definition });
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

  test("metric: split-name matches (shortName, options) form", () => {
    const positional = defineFeature("a", (r) => {
      r.metric("created", { type: "counter" });
    });
    const objectForm = defineFeature("b", (r) => {
      r.metric({ name: "created", type: "counter" });
    });
    expect(objectForm.metrics).toEqual(positional.metrics);
  });

  test("secret: split-name matches (shortName, options) form (same feature name for qualifiedName parity)", () => {
    const positional = defineFeature("stripe", (r) => {
      r.secret("apiKey", { label: { en: "Stripe API Key" }, scope: "tenant" });
    });
    const objectForm = defineFeature("stripe", (r) => {
      r.secret({ name: "apiKey", label: { en: "Stripe API Key" }, scope: "tenant" });
    });
    expect(objectForm.secretKeys).toEqual(positional.secretKeys);
  });

  test("secret: an empty writeRoles list is rejected at declaration", () => {
    expect(() =>
      defineFeature("stripe", (r) => {
        r.secret("apiKey", { label: { en: "Stripe API Key" }, scope: "tenant", writeRoles: [] });
      }),
    ).toThrow(/\[Feature stripe\] Secret "apiKey" declares an empty writeRoles list/);
  });

  test("secret: a non-empty writeRoles list is kept on the key definition", () => {
    const feature = defineFeature("stripe", (r) => {
      r.secret("apiKey", {
        label: { en: "Stripe API Key" },
        scope: "tenant",
        writeRoles: ["SystemAdmin"],
      });
    });
    expect(feature.secretKeys["apiKey"]?.writeRoles).toEqual(["SystemAdmin"]);
  });

  test("secretNamespace: split-name matches (shortName, options) form and derives the prefix", () => {
    const options = { label: { en: "Hook tokens" }, scope: "tenant" } as const;
    const positional = defineFeature("step-dispatcher", (r) => {
      r.secretNamespace("webhook-auth", options);
    });
    const objectForm = defineFeature("step-dispatcher", (r) => {
      r.secretNamespace({ name: "webhook-auth", ...options });
    });
    expect(objectForm.secretNamespaces).toEqual(positional.secretNamespaces);
    expect(positional.secretNamespaces["webhook-auth"]?.qualifiedPrefix).toBe(
      "step-dispatcher:webhook-auth.",
    );
  });

  test("secretNamespace: a duplicate name within a feature throws", () => {
    expect(() =>
      defineFeature("stripe", (r) => {
        r.secretNamespace("hooks", { label: { en: "Hooks" }, scope: "tenant" });
        r.secretNamespace("hooks", { label: { en: "Hooks" }, scope: "tenant" });
      }),
    ).toThrow(/\[Feature stripe\] Secret namespace "hooks" already registered/);
  });

  test("secretNamespace: an empty writeRoles list is rejected at declaration", () => {
    expect(() =>
      defineFeature("stripe", (r) => {
        r.secretNamespace("hooks", { label: { en: "Hooks" }, scope: "tenant", writeRoles: [] });
      }),
    ).toThrow(/\[Feature stripe\] Secret namespace "hooks" declares an empty writeRoles list/);
  });

  test("relation: two-field ({ entity, name, ...def }) matches (entity, name, definition) form", () => {
    const definition = { type: "belongsTo" as const, target: "user", foreignKey: "supplierId" };
    const positional = defineFeature("a", (r) => {
      r.entity({ name: "item", fields: {} });
      r.relation("item", "supplier", definition);
    });
    const objectForm = defineFeature("b", (r) => {
      r.entity({ name: "item", fields: {} });
      r.relation({ entity: "item", name: "supplier", ...definition });
    });
    expect(objectForm.relations).toEqual(positional.relations);
  });

  test("referenceData: two-field ({ entity, data, ...opts }) matches (entity, data, options) form", () => {
    const data = [{ id: "a", label: "A" }];
    const positional = defineFeature("a", (r) => {
      r.referenceData("category", data, { upsertKey: "id" });
    });
    const objectForm = defineFeature("b", (r) => {
      r.referenceData({ entity: "category", data, upsertKey: "id" });
    });
    expect(objectForm.referenceData).toEqual(positional.referenceData);
  });

  test("useExtension: two-field ({ name, entity, ...opts }) matches (extensionName, entity, options) form", () => {
    const positional = defineFeature("a", (r) => {
      r.useExtension("audit-log", "item", { verbose: true });
    });
    const objectForm = defineFeature("b", (r) => {
      r.useExtension({ name: "audit-log", entity: "item", verbose: true });
    });
    expect(objectForm.extensionUsages).toEqual(positional.extensionUsages);
  });

  test("claimKey: generic split-name matches (shortName, options) form", () => {
    const positional = defineFeature("drivers", (r) => {
      r.claimKey("teamId", { type: "string" });
    });
    const objectForm = defineFeature("drivers", (r) => {
      r.claimKey({ name: "teamId", type: "string" });
    });
    expect(objectForm.claimKeys).toEqual(positional.claimKeys);
  });

  test("job: full-definition object matches (name, options, handler) form", () => {
    const handler = async () => {};
    const positional = defineFeature("a", (r) => {
      r.job("reconcile", { trigger: { manual: true } }, handler);
    });
    const objectForm = defineFeature("b", (r) => {
      r.job({ name: "reconcile", trigger: { manual: true }, handler });
    });
    expect(objectForm.jobs).toEqual(positional.jobs);
  });

  test("notification: split-name matches (name, definition) form", () => {
    const recipient = () => null;
    const data = () => ({});
    const positional = defineFeature("a", (r) => {
      r.notification("itemLowStock", { trigger: { on: "item:lowStock" }, recipient, data });
    });
    const objectForm = defineFeature("b", (r) => {
      r.notification({ name: "itemLowStock", trigger: { on: "item:lowStock" }, recipient, data });
    });
    expect(objectForm.notifications).toEqual(positional.notifications);
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
  ];

  test("r.requires rejects a misspelled key and extra arguments instead of dropping them", () => {
    expect(() =>
      defineFeature("legacy", (r) => {
        Reflect.apply(r.requires, r, [{ feature: ["auth"] }]);
      }),
    ).toThrow("[Feature legacy] r.requires() needs { features: string[] }");
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
        // @ts-expect-error validation hooks have no escapeHatch
        r.hook({
          type: "validation",
          target: "item",
          handler: () => null,
          escapeHatch: { reason: "not allowed here" },
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

  describe("positional calls missing a required argument", () => {
    test("metric without options names the feature, method and argument", () => {
      expect(() =>
        defineFeature("missing-arg", (r) => {
          // @ts-expect-error the typed overload requires options; an untyped JS caller can omit them
          r.metric("orders_total");
        }),
      ).toThrow("[Feature missing-arg] r.metric() needs its options argument");
    });

    test("job without handler names the missing handler", () => {
      expect(() =>
        defineFeature("missing-arg", (r) => {
          // @ts-expect-error the typed overload requires the handler
          r.job("reconcile", { trigger: { manual: true } });
        }),
      ).toThrow("[Feature missing-arg] r.job() needs its handler argument");
    });

    test("relation without definition names the missing definition", () => {
      expect(() =>
        defineFeature("missing-arg", (r) => {
          // @ts-expect-error the typed overload requires the definition
          r.relation("item", "supplier");
        }),
      ).toThrow("[Feature missing-arg] r.relation() needs its definition argument");
    });

    test("the same calls with every argument register normally", () => {
      const feature = defineFeature("complete-args", (r) => {
        r.metric("orders_total", { type: "counter" });
      });
      expect(feature.metrics?.["orders_total"]).toMatchObject({ shortName: "orders_total" });
    });
  });
});
