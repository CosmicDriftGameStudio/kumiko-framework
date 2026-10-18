import { describe, expect, test } from "bun:test";
import { createTestStoredEvent } from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import { createEntity, createRegistry, defineFeature, HookPhases } from "../index.ts";
import type { AppContext, PostSaveHookFn, SaveContext } from "../types/index.ts";

const dummySaveContext: SaveContext = {
  kind: "save",
  event: createTestStoredEvent(),
  id: "thing-1" as SaveContext["id"],
  data: {},
  changes: {},
  previous: {},
  isNew: true,
};
const dummyAppContext = {} as AppContext;

// These tests lock in the phase defaults + filtering so the invariants survive
// refactors. Behavior under test:
//   - r.hook({ type: "postSave", ... }) defaults to afterCommit
//   - r.hook({ type: "postSave", ..., phase: inTransaction }) routes to the inTx bucket
//   - r.hook({ type: "preDelete", ... }) always lands in inTransaction (no option)
//   - Registry getters filter by phase when asked, return all otherwise

const noopSave: PostSaveHookFn = async () => undefined;

describe("HookPhases defaults", () => {
  test("postSave hook without options defaults to afterCommit phase", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({ name: "thing", ...createEntity({ table: "things", fields: {} }) });
      r.writeHandler({
        name: "thing:create",
        schema: z.object({}),
        handler: async () => ({ isSuccess: true, data: null }),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.hook({ type: "postSave", target: "thing:create", handler: noopSave });
    });

    const entry = feature.hooks?.postSave?.["thing:create"];
    expect(entry).toHaveLength(1);
    expect(entry?.[0]?.phase).toBe(HookPhases.afterCommit);
  });

  test("postSave hook respects explicit phase option", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({ name: "thing", ...createEntity({ table: "things", fields: {} }) });
      r.writeHandler({
        name: "thing:create",
        schema: z.object({}),
        handler: async () => ({ isSuccess: true, data: null }),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.hook({
        type: "postSave",
        target: "thing:create",
        handler: noopSave,
        phase: HookPhases.inTransaction,
      });
    });

    const entry = feature.hooks?.postSave?.["thing:create"];
    expect(entry?.[0]?.phase).toBe(HookPhases.inTransaction);
  });

  test("preDelete hook is always inTransaction (no option)", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({ name: "thing", ...createEntity({ table: "things", fields: {} }) });
      r.writeHandler({
        name: "thing:delete",
        schema: z.object({ id: z.uuid() }),
        handler: async () => ({
          isSuccess: true,
          data: null,
        }),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.hook({ type: "preDelete", target: "thing:delete", handler: async () => undefined });
    });

    const entry = feature.hooks?.preDelete?.["thing:delete"];
    expect(entry?.[0]?.phase).toBe(HookPhases.inTransaction);
  });

  test("hook({allOf}) postSave defaults to afterCommit, preDelete is forced inTransaction", () => {
    const feature = defineFeature("test", (r) => {
      const thing = r.entity({ name: "thing", ...createEntity({ table: "things", fields: {} }) });
      r.hook({ type: "postSave", target: { allOf: thing }, handler: noopSave });
      r.hook({ type: "preDelete", target: { allOf: thing }, handler: async () => undefined });
    });

    expect(feature.entityHooks?.postSave?.["thing"]?.[0]?.phase).toBe(HookPhases.afterCommit);
    expect(feature.entityHooks?.preDelete?.["thing"]?.[0]?.phase).toBe(HookPhases.inTransaction);
  });
});

describe("Registry phase filtering", () => {
  test("getPostSaveHooks filters by phase when given", async () => {
    const inTxCalls: SaveContext[] = [];
    const afterCalls: SaveContext[] = [];
    const inTxFn: PostSaveHookFn = async (result) => {
      inTxCalls.push(result);
    };
    const afterFn: PostSaveHookFn = async (result) => {
      afterCalls.push(result);
    };

    const feature = defineFeature("test", (r) => {
      r.entity({ name: "thing", ...createEntity({ table: "things", fields: {} }) });
      r.writeHandler({
        name: "thing:create",
        schema: z.object({}),
        handler: async () => ({ isSuccess: true, data: null }),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.hook({
        type: "postSave",
        target: "thing:create",
        handler: inTxFn,
        phase: HookPhases.inTransaction,
      });
      r.hook({ type: "postSave", target: "thing:create", handler: afterFn }); // default afterCommit
    });

    const registry = createRegistry([feature]);
    const handlerQn = "test:write:thing:create";

    const inTxOnly = registry.getPostSaveHooks(handlerQn, HookPhases.inTransaction);
    const afterOnly = registry.getPostSaveHooks(handlerQn, HookPhases.afterCommit);
    const all = registry.getPostSaveHooks(handlerQn);

    // Hooks are wrapped for the SYSTEM identity-switch gate (system-identity-
    // switch.ts), so the stored fn is no longer reference-equal to the
    // original — prove behaviour (calling the original) instead.
    expect(inTxOnly).toHaveLength(1);
    await inTxOnly[0]?.(dummySaveContext, dummyAppContext);
    expect(inTxCalls).toEqual([dummySaveContext]);
    expect(afterCalls).toEqual([]);

    expect(afterOnly).toHaveLength(1);
    await afterOnly[0]?.(dummySaveContext, dummyAppContext);
    expect(afterCalls).toEqual([dummySaveContext]);

    expect(all).toHaveLength(2);
  });

  test("getPostSaveHooks returns empty array when no hooks for handler", () => {
    const feature = defineFeature("test", (r) => {
      r.entity({ name: "thing", ...createEntity({ table: "things", fields: {} }) });
      r.writeHandler({
        name: "thing:create",
        schema: z.object({}),
        handler: async () => ({ isSuccess: true, data: null }),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
    });

    const registry = createRegistry([feature]);
    expect(registry.getPostSaveHooks("test:write:thing:create")).toEqual([]);
    expect(registry.getPostSaveHooks("test:write:thing:create", HookPhases.inTransaction)).toEqual(
      [],
    );
  });

  test("getEntityPostSaveHooks filters by phase", async () => {
    const inTxCalls: SaveContext[] = [];
    const afterCalls: SaveContext[] = [];
    const inTxFn: PostSaveHookFn = async (result) => {
      inTxCalls.push(result);
    };
    const afterFn: PostSaveHookFn = async (result) => {
      afterCalls.push(result);
    };

    const feature = defineFeature("test", (r) => {
      const thing = r.entity({ name: "thing", ...createEntity({ table: "things", fields: {} }) });
      r.hook({
        type: "postSave",
        target: { allOf: thing },
        handler: inTxFn,
        phase: HookPhases.inTransaction,
      });
      r.hook({ type: "postSave", target: { allOf: thing }, handler: afterFn });
    });

    const registry = createRegistry([feature]);
    const inTxHooks = registry.getEntityPostSaveHooks("thing", HookPhases.inTransaction);
    const afterHooks = registry.getEntityPostSaveHooks("thing", HookPhases.afterCommit);

    expect(inTxHooks).toHaveLength(1);
    await inTxHooks[0]?.(dummySaveContext, dummyAppContext);
    expect(inTxCalls).toEqual([dummySaveContext]);
    expect(afterCalls).toEqual([]);

    expect(afterHooks).toHaveLength(1);
    await afterHooks[0]?.(dummySaveContext, dummyAppContext);
    expect(afterCalls).toEqual([dummySaveContext]);

    expect(registry.getEntityPostSaveHooks("thing")).toHaveLength(2);
  });
});
