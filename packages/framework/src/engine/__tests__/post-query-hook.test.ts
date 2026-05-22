import { describe, expect, test } from "vitest";
import { z } from "zod";
import { createEntity, createRegistry, defineFeature } from "../index";
import type { PostQueryHookFn } from "../types";

// postQuery-Hook (F1) — feuert nach Query-Handler-Execute, vor Field-Access-
// Read-Filter. Zwei Registrierungs-Pfade:
//   - r.hook("postQuery", "ns:query:list", fn) — handler-keyed
//   - r.entityHook("postQuery", "thing", fn)   — entity-keyed (alle Queries)
//
// Diese Tests pinnen die Invarianten:
//   1. Beide Registrierungs-Pfade landen in unabhängigen Maps
//   2. Hook-Function-Type ist PostQueryHookFn (rows-shape input + output)
//   3. Registry-Getter geben jeweilige Hooks zurück
//   4. Mehrere Hooks pro Target sind möglich (stacking)

const noop: PostQueryHookFn = async ({ rows }) => ({ rows });

describe("postQuery hook registration", () => {
  test("r.hook('postQuery', handlerQn, fn) lands in handler-keyed lifecycleHooks map", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("thing", createEntity({ table: "things", fields: {} }));
      r.queryHandler("thing:list", z.object({}), async () => [], { access: { openToAll: true } });
      r.hook("postQuery", "thing:list", noop);
    });

    // feature.hooks.postQuery is keyed by raw handler-name (qualification
    // happens at registry-merge time).
    const entry = feature.hooks.postQuery["thing:list"];
    expect(entry).toHaveLength(1);
    expect(entry?.[0]?.featureName).toBe("test");
  });

  test("r.entityHook('postQuery', entity, fn) lands in entity-keyed entityHooks map", () => {
    const feature = defineFeature("test", (r) => {
      const thing = r.entity("thing", createEntity({ table: "things", fields: {} }));
      r.entityHook("postQuery", thing, noop);
    });

    const entry = feature.entityHooks.postQuery["thing"];
    expect(entry).toHaveLength(1);
    expect(entry?.[0]?.featureName).toBe("test");
  });

  test("multiple postQuery-hooks on same target stack", () => {
    const hookA: PostQueryHookFn = async ({ rows }) => ({ rows });
    const hookB: PostQueryHookFn = async ({ rows }) => ({ rows });

    const feature = defineFeature("test", (r) => {
      const thing = r.entity("thing", createEntity({ table: "things", fields: {} }));
      r.entityHook("postQuery", thing, hookA);
      r.entityHook("postQuery", thing, hookB);
    });

    expect(feature.entityHooks.postQuery["thing"]).toHaveLength(2);
  });
});

describe("Registry getters", () => {
  test("getPostQueryHooks returns handler-keyed hooks", () => {
    const fn: PostQueryHookFn = async ({ rows }) => ({ rows });

    const feature = defineFeature("test", (r) => {
      r.entity("thing", createEntity({ table: "things", fields: {} }));
      r.queryHandler("thing:list", z.object({}), async () => [], { access: { openToAll: true } });
      r.hook("postQuery", "thing:list", fn);
    });

    const registry = createRegistry([feature]);
    const hooks = registry.getPostQueryHooks("test:query:thing:list");
    expect(hooks).toHaveLength(1);
    expect(hooks[0]).toBe(fn);
  });

  test("getEntityPostQueryHooks returns entity-keyed hooks", () => {
    const fn: PostQueryHookFn = async ({ rows }) => ({ rows });

    const feature = defineFeature("test", (r) => {
      const thing = r.entity("thing", createEntity({ table: "things", fields: {} }));
      r.entityHook("postQuery", thing, fn);
    });

    const registry = createRegistry([feature]);
    const hooks = registry.getEntityPostQueryHooks("thing");
    expect(hooks).toHaveLength(1);
    expect(hooks[0]).toBe(fn);
  });

  test("getPostQueryHooks empty for unknown target", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("thing", createEntity({ table: "things", fields: {} }));
    });

    const registry = createRegistry([feature]);
    expect(registry.getPostQueryHooks("unknown:query:list")).toEqual([]);
    expect(registry.getEntityPostQueryHooks("unknown-entity")).toEqual([]);
  });
});

describe("Hook function semantics", () => {
  test("hook can mutate rows (return modified rows-array)", async () => {
    const enrich: PostQueryHookFn = async ({ rows }) => ({
      rows: rows.map((row) => ({ ...row, enriched: true })),
    });

    const feature = defineFeature("test", (r) => {
      const thing = r.entity("thing", createEntity({ table: "things", fields: {} }));
      r.entityHook("postQuery", thing, enrich);
    });

    const registry = createRegistry([feature]);
    const hooks = registry.getEntityPostQueryHooks("thing");
    const inputRows: ReadonlyArray<Record<string, unknown>> = [{ id: "1" }, { id: "2" }];
    // Context shape is { user, db, ... } in real runtime; unit-tests stub.
    const result = await hooks[0]?.(
      { entityName: "thing", rows: inputRows },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as never,
    );
    expect(result?.rows).toEqual([
      { id: "1", enriched: true },
      { id: "2", enriched: true },
    ]);
  });
});
