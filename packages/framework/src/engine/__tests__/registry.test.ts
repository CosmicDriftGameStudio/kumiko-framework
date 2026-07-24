import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createTenantConfig } from "../config-helpers";
import { defineFeature } from "../define-feature";
import { createEntity, createTextField } from "../factories";
import { createRegistry } from "../registry";
import type { FeatureDefinition } from "../types/feature";

// Hand-built FeatureDefinition that bypasses defineFeature() — the latter
// initializes every slot (entities, entityHooks, …) to an empty map. A
// FeatureDefinition assembled off that path (cast at a system boundary) can
// leave slots `undefined`, which the type forbids but createRegistry's
// entity-iteration paths must survive: `Object.entries/values(undefined)`
// throws. The double-cast is the deliberate type-violation that reproduces it.
function bareFeature(overrides: Record<string, unknown> = {}): FeatureDefinition {
  return {
    name: "probe",
    requires: [],
    optionalRequires: [],
    ...overrides,
  } as unknown as FeatureDefinition;
}

describe("createRegistry slot robustness", () => {
  // Regression for the hardening PRs (#95/#98/#210): the entity- and
  // hook-iterating paths in createRegistry must not assume the optional
  // `entities` / `entityHooks` slots are present. defineFeature masks this in
  // every test that goes through the normal author API, so the gap only
  // surfaced when a partial feature reached the boot path.

  test("tolerates a hand-built feature with entities + entityHooks omitted", () => {
    // Exercises the entity-iteration paths (allEntities loop + hasFieldAccessRules)
    // — both crash on `Object.{keys,values}(undefined)` without the `?? {}` guard.
    expect(() => createRegistry([bareFeature()])).not.toThrow();
  });

  test("tolerates entities: undefined (Object.keys/values guard)", () => {
    expect(() => createRegistry([bareFeature({ entities: undefined })])).not.toThrow();
  });

  test("tolerates entityHooks with every slot undefined", () => {
    expect(() =>
      createRegistry([
        bareFeature({
          entities: {},
          entityHooks: {
            postSave: undefined,
            preDelete: undefined,
            postDelete: undefined,
            postQuery: undefined,
          },
        }),
      ]),
    ).not.toThrow();
  });

  test("tolerates entityHooks map itself undefined", () => {
    expect(() =>
      createRegistry([bareFeature({ entities: {}, entityHooks: undefined })]),
    ).not.toThrow();
  });
});

describe("getAllQueryHandlers", () => {
  test("returns every registered query handler, qualified, across multiple features", () => {
    const taskEntity = createEntity({
      table: "registry_test_tasks",
      fields: { title: createTextField({ required: true }) },
    });
    const noteEntity = createEntity({
      table: "registry_test_notes",
      fields: { body: createTextField({ required: true }) },
    });
    const taskFeature = defineFeature("registry-test-task", (r) => {
      r.crud("task", taskEntity, {
        write: { access: { roles: ["Admin"] } },
        read: { access: { openToAll: true } },
      });
    });
    const noteFeature = defineFeature("registry-test-note", (r) => {
      r.crud("note", noteEntity, {
        write: { access: { roles: ["Admin"] } },
        read: { access: { openToAll: true } },
      });
    });

    const registry = createRegistry([taskFeature, noteFeature]);
    const handlers = registry.getAllQueryHandlers();

    expect(handlers.get("registry-test-task:query:task:list")).toBeDefined();
    expect(handlers.get("registry-test-note:query:note:list")).toBeDefined();
    // Same Map instance getQueryHandler reads from, not a copy that can drift.
    expect(handlers.get("registry-test-task:query:task:list")).toBe(
      registry.getQueryHandler("registry-test-task:query:task:list"),
    );
  });

  test("empty registry returns an empty map, not undefined", () => {
    const registry = createRegistry([]);
    expect(registry.getAllQueryHandlers().size).toBe(0);
  });
});

describe("getAllStreamHandlers", () => {
  test("returns every registered stream handler, qualified, across multiple features", () => {
    const aiFeature = defineFeature("registry-test-ai", (r) => {
      r.streamHandler("chat:complete", z.object({ prompt: z.string() }), async function* () {}, {
        access: { openToAll: true },
      });
    });
    const otherFeature = defineFeature("registry-test-other", (r) => {
      r.streamHandler("chat:complete", z.object({ prompt: z.string() }), async function* () {}, {
        access: { openToAll: true },
      });
    });

    const registry = createRegistry([aiFeature, otherFeature]);
    const handlers = registry.getAllStreamHandlers();

    expect(handlers.get("registry-test-ai:stream:chat:complete")).toBeDefined();
    expect(handlers.get("registry-test-other:stream:chat:complete")).toBeDefined();
    // Same Map instance getStreamHandler reads from, not a copy that can drift.
    expect(handlers.get("registry-test-ai:stream:chat:complete")).toBe(
      registry.getStreamHandler("registry-test-ai:stream:chat:complete"),
    );
  });

  test("empty registry returns an empty map, not undefined", () => {
    const registry = createRegistry([]);
    expect(registry.getAllStreamHandlers().size).toBe(0);
  });

  test("duplicate stream-handler short-name across features qualifies independently, no collision", () => {
    const aiFeature = defineFeature("registry-test-dup-a", (r) => {
      r.streamHandler("chat:complete", z.object({}), async function* () {});
    });
    const otherFeature = defineFeature("registry-test-dup-b", (r) => {
      r.streamHandler("chat:complete", z.object({}), async function* () {});
    });
    expect(() => createRegistry([aiFeature, otherFeature])).not.toThrow();
  });

  test("two distinct feature names that kebab-collide throw on the qualified stream-handler clash", () => {
    // "registry-test-kebab-dup" and "registryTestKebabDup" are different raw
    // feature.name values (so the earlier Duplicate-feature guard doesn't
    // fire) but toKebab() collapses both to the same qualified name.
    const featureA = defineFeature("registry-test-kebab-dup", (r) => {
      r.streamHandler("chat:complete", z.object({}), async function* () {});
    });
    const featureB = defineFeature("registryTestKebabDup", (r) => {
      r.streamHandler("chat:complete", z.object({}), async function* () {});
    });
    expect(() => createRegistry([featureA, featureB])).toThrow(/Duplicate stream handler/);
  });

  test("object-form streamHandler registration preserves schema/access/rateLimit", () => {
    const schema = z.object({ prompt: z.string() });
    const handlerFn = async function* () {};
    const feature = defineFeature("registry-test-object-form", (r) => {
      r.streamHandler({
        name: "chat:complete",
        schema,
        handler: handlerFn,
        access: { openToAll: true },
        rateLimit: { per: "ip+handler", limit: 5, windowSeconds: 60 },
      });
    });

    const registry = createRegistry([feature]);
    const registered = registry.getStreamHandler("registry-test-object-form:stream:chat:complete");

    expect(registered).toBeDefined();
    expect(registered?.schema).toBe(schema);
    expect(registered?.handler).toBe(handlerFn);
    expect(registered?.access).toEqual({ openToAll: true });
    expect(registered?.rateLimit).toEqual({ per: "ip+handler", limit: 5, windowSeconds: 60 });
  });
});

describe("extensionSelector boot-validation", () => {
  function foundationFeature() {
    return defineFeature("probe-foundation", (r) => {
      r.extendsRegistrar("probeTransport", { onRegister: () => undefined });
      const configKeys = r.config({
        keys: { provider: createTenantConfig("text", { default: "" }) },
      });
      r.extensionSelector("probeTransport", configKeys.provider);
      return { configKeys };
    });
  }

  test("valid declaration lands in getAllExtensionSelectors", () => {
    const registry = createRegistry([foundationFeature()]);
    expect(registry.getAllExtensionSelectors().get("probeTransport")).toBe(
      "probe-foundation:config:provider",
    );
  });

  test("usages carry the owning featureName after merge", () => {
    const provider = defineFeature("probe-smtp", (r) => {
      r.useExtension("probeTransport", "smtp");
    });
    const registry = createRegistry([foundationFeature(), provider]);
    const usage = registry.getExtensionUsages("probeTransport")[0];
    expect(usage?.featureName).toBe("probe-smtp");
  });

  test("duplicate selector across features fails the boot", () => {
    const rival = defineFeature("probe-rival", (r) => {
      const configKeys = r.config({
        keys: { provider: createTenantConfig("text", { default: "" }) },
      });
      r.extensionSelector("probeTransport", configKeys.provider);
      return { configKeys };
    });
    expect(() => createRegistry([foundationFeature(), rival])).toThrow(
      /Duplicate extension selector/,
    );
  });

  test("selector for an undeclared extension fails the boot", () => {
    const orphan = defineFeature("probe-orphan", (r) => {
      const configKeys = r.config({
        keys: { provider: createTenantConfig("text", { default: "" }) },
      });
      r.extensionSelector("ghostTransport", configKeys.provider);
      return { configKeys };
    });
    expect(() => createRegistry([orphan])).toThrow(/no feature registers that extension/);
  });

  test("selector pointing at an unknown config key fails the boot", () => {
    const typo = defineFeature("probe-typo", (r) => {
      r.extendsRegistrar("probeTransport", { onRegister: () => undefined });
      r.extensionSelector("probeTransport", "probe-typo:config:does-not-exist");
    });
    expect(() => createRegistry([typo])).toThrow(/unknown config key/);
  });

  test("declaring the selector twice in one feature fails at define-time", () => {
    expect(() =>
      defineFeature("probe-double", (r) => {
        const configKeys = r.config({
          keys: { provider: createTenantConfig("text", { default: "" }) },
        });
        r.extensionSelector("probeTransport", configKeys.provider);
        r.extensionSelector("probeTransport", configKeys.provider);
      }),
    ).toThrow(/declared twice/);
  });

  // 437/2: createRegistry now delegates this check to
  // validateExtensionPreSaveWiring (shared with validateBoot's standalone
  // callers) instead of a duplicate inline computation — pins that
  // createRegistry itself still enforces it, not just validateBoot.
  test("throws when extension preSave targets entity with no mapped write handlers", () => {
    const ext = defineFeature("cap-ext", (r) => {
      r.extendsRegistrar("credit-cap", {
        hooks: { preSave: async (changes) => changes },
      });
    });
    const consumer = defineFeature("money-horse", (r) => {
      r.requires("cap-ext");
      r.entity("credit", createEntity({ table: "Credits", fields: { name: createTextField() } }));
      r.writeHandler(
        "doSomething",
        z.object({}),
        async () => ({ isSuccess: true as const, data: {} }),
        { access: { openToAll: true } },
      );
      r.useExtension("credit-cap", "credit");
    });
    expect(() => createRegistry([ext, consumer])).toThrow(
      /no write handler is entity-mapped to "credit"/i,
    );
  });
});
