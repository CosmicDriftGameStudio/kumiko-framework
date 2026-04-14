import { describe, expect, test } from "vitest";
import { z } from "zod";
import { createEntity, createRegistry, defineFeature, HookPhases } from "../index";
import type { PostSaveHookFn } from "../types";

// These tests lock in the phase defaults + filtering so the invariants survive
// refactors. Behavior under test:
//   - r.hook("postSave", ...) defaults to afterCommit
//   - r.hook("postSave", ..., { phase: inTransaction }) routes to the inTx bucket
//   - r.hook("preDelete", ...) always lands in inTransaction (no option)
//   - Registry getters filter by phase when asked, return all otherwise

const noopSave: PostSaveHookFn = async () => undefined;

describe("HookPhases defaults", () => {
  test("postSave hook without options defaults to afterCommit phase", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("thing", createEntity({ table: "things", fields: {} }));
      r.writeHandler("thing:create", z.object({}), async () => ({ isSuccess: true, data: null }));
      r.hook("postSave", "thing:create", noopSave);
    });

    const entry = feature.hooks.postSave["thing:create"];
    expect(entry).toHaveLength(1);
    expect(entry?.[0]?.phase).toBe(HookPhases.afterCommit);
  });

  test("postSave hook respects explicit phase option", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("thing", createEntity({ table: "things", fields: {} }));
      r.writeHandler("thing:create", z.object({}), async () => ({ isSuccess: true, data: null }));
      r.hook("postSave", "thing:create", noopSave, { phase: HookPhases.inTransaction });
    });

    const entry = feature.hooks.postSave["thing:create"];
    expect(entry?.[0]?.phase).toBe(HookPhases.inTransaction);
  });

  test("preDelete hook is always inTransaction (no option)", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("thing", createEntity({ table: "things", fields: {} }));
      r.writeHandler("thing:delete", z.object({ id: z.number() }), async () => ({
        isSuccess: true,
        data: null,
      }));
      r.hook("preDelete", "thing:delete", async () => undefined);
    });

    const entry = feature.hooks.preDelete["thing:delete"];
    expect(entry?.[0]?.phase).toBe(HookPhases.inTransaction);
  });

  test("entityHook postSave defaults to afterCommit, preDelete is forced inTransaction", () => {
    const feature = defineFeature("test", (r) => {
      const thing = r.entity("thing", createEntity({ table: "things", fields: {} }));
      r.entityHook("postSave", thing, noopSave);
      r.entityHook("preDelete", thing, async () => undefined);
    });

    expect(feature.entityHooks.postSave["thing"]?.[0]?.phase).toBe(HookPhases.afterCommit);
    expect(feature.entityHooks.preDelete["thing"]?.[0]?.phase).toBe(HookPhases.inTransaction);
  });
});

describe("Registry phase filtering", () => {
  test("getPostSaveHooks filters by phase when given", () => {
    const inTxFn: PostSaveHookFn = async () => undefined;
    const afterFn: PostSaveHookFn = async () => undefined;

    const feature = defineFeature("test", (r) => {
      r.entity("thing", createEntity({ table: "things", fields: {} }));
      r.writeHandler("thing:create", z.object({}), async () => ({ isSuccess: true, data: null }));
      r.hook("postSave", "thing:create", inTxFn, { phase: HookPhases.inTransaction });
      r.hook("postSave", "thing:create", afterFn); // default afterCommit
    });

    const registry = createRegistry([feature]);
    const handlerQn = "test:write:thing:create";

    const inTxOnly = registry.getPostSaveHooks(handlerQn, HookPhases.inTransaction);
    const afterOnly = registry.getPostSaveHooks(handlerQn, HookPhases.afterCommit);
    const all = registry.getPostSaveHooks(handlerQn);

    expect(inTxOnly).toHaveLength(1);
    expect(inTxOnly[0]).toBe(inTxFn);
    expect(afterOnly).toHaveLength(1);
    expect(afterOnly[0]).toBe(afterFn);
    expect(all).toHaveLength(2);
  });

  test("getPostSaveHooks returns empty array when no hooks for handler", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("thing", createEntity({ table: "things", fields: {} }));
      r.writeHandler("thing:create", z.object({}), async () => ({ isSuccess: true, data: null }));
    });

    const registry = createRegistry([feature]);
    expect(registry.getPostSaveHooks("test:write:thing:create")).toEqual([]);
    expect(registry.getPostSaveHooks("test:write:thing:create", HookPhases.inTransaction)).toEqual(
      [],
    );
  });

  test("getEntityPostSaveHooks filters by phase", () => {
    const inTxFn: PostSaveHookFn = async () => undefined;
    const afterFn: PostSaveHookFn = async () => undefined;

    const feature = defineFeature("test", (r) => {
      const thing = r.entity("thing", createEntity({ table: "things", fields: {} }));
      r.entityHook("postSave", thing, inTxFn, { phase: HookPhases.inTransaction });
      r.entityHook("postSave", thing, afterFn);
    });

    const registry = createRegistry([feature]);
    expect(registry.getEntityPostSaveHooks("thing", HookPhases.inTransaction)).toEqual([inTxFn]);
    expect(registry.getEntityPostSaveHooks("thing", HookPhases.afterCommit)).toEqual([afterFn]);
    expect(registry.getEntityPostSaveHooks("thing")).toHaveLength(2);
  });
});
