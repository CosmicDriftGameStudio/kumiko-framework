import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { createEntity, createRegistry, defineFeature } from "../index.ts";
import type { AppContext, PostQueryHookFn } from "../types/index.ts";

// The hooks under test never read context (they only transform rows), so a
// stub at the cast-boundary is sufficient — no real db/redis/registry needed.
const stubContext = {} as unknown as AppContext;

// postQuery-Hook (F1) — feuert nach Query-Handler-Execute, vor Field-Access-
// Read-Filter. Zwei Registrierungs-Pfade:
//   - r.hook({ type: "postQuery", target: "ns:query:list", handler }) — handler-keyed
//   - r.hook({ type: "postQuery", target: { allOf: "thing" }, handler }) — entity-keyed (alle Queries)
//
// Diese Tests pinnen die Invarianten:
//   1. Beide Registrierungs-Pfade landen in unabhängigen Maps
//   2. Hook-Function-Type ist PostQueryHookFn (rows-shape input + output)
//   3. Registry-Getter geben jeweilige Hooks zurück
//   4. Mehrere Hooks pro Target sind möglich (stacking)

const noop: PostQueryHookFn = async ({ rows }) => ({ rows });

describe("postQuery hook registration", () => {
  test("r.hook({ type: 'postQuery', target: handlerQn }) lands in handler-keyed lifecycleHooks map", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({ name: "thing", ...createEntity({ table: "things", fields: {} }) });
      r.queryHandler({
        name: "thing:list",
        schema: z.object({}),
        handler: async () => [],
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.hook({ type: "postQuery", target: "thing:list", handler: noop });
    });

    // feature.hooks.postQuery is keyed by raw handler-name (qualification
    // happens at registry-merge time).
    const entry = feature.hooks?.postQuery?.["thing:list"];
    expect(entry).toHaveLength(1);
    expect(entry?.[0]?.featureName).toBe("test");
  });

  test("r.hook({ type: 'postQuery', target: { allOf: entity } }) lands in entity-keyed entityHooks map", () => {
    const feature = defineFeature("test", (r) => {
      const thing = r.entity({ name: "thing", ...createEntity({ table: "things", fields: {} }) });
      r.hook({ type: "postQuery", target: { allOf: thing }, handler: noop });
    });

    const entry = feature.entityHooks?.postQuery?.["thing"];
    expect(entry).toHaveLength(1);
    expect(entry?.[0]?.featureName).toBe("test");
  });

  test("multiple postQuery-hooks on same target stack", () => {
    const hookA: PostQueryHookFn = async ({ rows }) => ({ rows });
    const hookB: PostQueryHookFn = async ({ rows }) => ({ rows });

    const feature = defineFeature("test", (r) => {
      const thing = r.entity({ name: "thing", ...createEntity({ table: "things", fields: {} }) });
      r.hook({ type: "postQuery", target: { allOf: thing }, handler: hookA });
      r.hook({ type: "postQuery", target: { allOf: thing }, handler: hookB });
    });

    expect(feature.entityHooks?.postQuery?.["thing"]).toHaveLength(2);
  });
});

describe("Registry getters", () => {
  test("getPostQueryHooks returns handler-keyed hooks", async () => {
    const calls: ReadonlyArray<Record<string, unknown>>[] = [];
    const fn: PostQueryHookFn = async ({ rows }) => {
      calls.push(rows);
      return { rows };
    };

    const feature = defineFeature("test", (r) => {
      r.entity({ name: "thing", ...createEntity({ table: "things", fields: {} }) });
      r.queryHandler({
        name: "thing:list",
        schema: z.object({}),
        handler: async () => [],
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.hook({ type: "postQuery", target: "thing:list", handler: fn });
    });

    const registry = createRegistry([feature]);
    const hooks = registry.getPostQueryHooks("test:query:thing:list");
    expect(hooks).toHaveLength(1);
    // Hooks are wrapped for the SYSTEM identity-switch gate
    // (system-identity-switch.ts), so the stored fn is no longer
    // reference-equal to `fn` — prove behaviour (calling the original) instead.
    const inputRows: ReadonlyArray<Record<string, unknown>> = [{ id: "1" }];
    await hooks[0]?.({ entityName: "thing", rows: inputRows }, stubContext);
    expect(calls).toEqual([inputRows]);
  });

  test("getEntityPostQueryHooks returns entity-keyed hooks", async () => {
    const calls: ReadonlyArray<Record<string, unknown>>[] = [];
    const fn: PostQueryHookFn = async ({ rows }) => {
      calls.push(rows);
      return { rows };
    };

    const feature = defineFeature("test", (r) => {
      const thing = r.entity({ name: "thing", ...createEntity({ table: "things", fields: {} }) });
      r.hook({ type: "postQuery", target: { allOf: thing }, handler: fn });
    });

    const registry = createRegistry([feature]);
    const hooks = registry.getEntityPostQueryHooks("thing");
    expect(hooks).toHaveLength(1);
    const inputRows: ReadonlyArray<Record<string, unknown>> = [{ id: "1" }];
    await hooks[0]?.({ entityName: "thing", rows: inputRows }, stubContext);
    expect(calls).toEqual([inputRows]);
  });

  test("getPostQueryHooks empty for unknown target", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({ name: "thing", ...createEntity({ table: "things", fields: {} }) });
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
      const thing = r.entity({ name: "thing", ...createEntity({ table: "things", fields: {} }) });
      r.hook({ type: "postQuery", target: { allOf: thing }, handler: enrich });
    });

    const registry = createRegistry([feature]);
    const hooks = registry.getEntityPostQueryHooks("thing");
    const inputRows: ReadonlyArray<Record<string, unknown>> = [{ id: "1" }, { id: "2" }];
    // Context shape is { user, db, ... } in real runtime; unit-tests stub.
    const result = await hooks[0]?.({ entityName: "thing", rows: inputRows }, stubContext);
    expect(result?.rows).toEqual([
      { id: "1", enriched: true },
      { id: "2", enriched: true },
    ]);
  });
});
