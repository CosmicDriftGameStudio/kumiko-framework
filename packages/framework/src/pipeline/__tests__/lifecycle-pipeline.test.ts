import { describe, expect, spyOn, test } from "bun:test";
import { z } from "zod";
import {
  createEntity,
  createRegistry,
  createTextField,
  type DeleteContext,
  defineFeature,
  type PostSaveHookFn,
  type PreSaveHookFn,
  type SaveContext,
} from "../../engine";
import type { TenantId } from "../../engine/types/identifiers";
import { buildEventId, createLifecycleHooks, type SystemHooks } from "../lifecycle-pipeline";

function makeRegistry(hooks?: { preSave?: PreSaveHookFn[]; postSave?: PostSaveHookFn[] }) {
  const feature = defineFeature("test", (r) => {
    r.entity("user", createEntity({ table: "Users", fields: { email: createTextField() } }));
    // Dummy handler so hook targets resolve (boot validation requires it)
    r.writeHandler("user", z.object({}), async () => ({ isSuccess: true as const, data: null }), {
      access: { openToAll: true },
    });
    if (hooks?.preSave) {
      for (const h of hooks.preSave) r.hook("preSave", "user", h);
    }
    if (hooks?.postSave) {
      for (const h of hooks.postSave) r.hook("postSave", "user", h);
    }
  });
  return createRegistry([feature]);
}

const savectx: SaveContext = {
  kind: "save",
  id: 1,
  data: { email: "test@test.de", tenantId: "00000000-0000-4000-8000-000000000001" },
  changes: { email: "test@test.de" },
  previous: {},
  isNew: true,
};

// --- PreSave pipeline ---

describe("runPreSave", () => {
  test("runs feature hooks in order", async () => {
    const calls: string[] = [];
    const registry = makeRegistry({
      preSave: [
        async (changes) => {
          calls.push("a");
          return changes;
        },
        async (changes) => {
          calls.push("b");
          return changes;
        },
      ],
    });

    const pipeline = createLifecycleHooks(registry);
    await pipeline.runPreSave("test:write:user", { email: "x" }, {}, true, {});
    expect(calls).toEqual(["a", "b"]);
  });

  test("feature hooks can modify changes", async () => {
    const registry = makeRegistry({
      preSave: [
        async (changes) => ({ ...changes, email: (changes["email"] as string).toLowerCase() }),
      ],
    });

    const pipeline = createLifecycleHooks(registry);
    const result = await pipeline.runPreSave(
      "test:write:user",
      { email: "MARC@TEST.DE" },
      {},
      true,
      {},
    );
    expect(result["email"]).toBe("marc@test.de");
  });

  test("system hooks run after feature hooks", async () => {
    const calls: string[] = [];
    const registry = makeRegistry({
      preSave: [
        async (changes) => {
          calls.push("feature");
          return changes;
        },
      ],
    });

    const systemHooks: SystemHooks = {
      preSave: [
        {
          name: "sys",
          priority: 1000,
          fn: async (changes) => {
            calls.push("system");
            return changes;
          },
        },
      ],
    };

    const pipeline = createLifecycleHooks(registry, systemHooks);
    await pipeline.runPreSave("test:write:user", {}, {}, true, {});
    expect(calls).toEqual(["feature", "system"]);
  });

  test("system hooks sorted by priority", async () => {
    const calls: string[] = [];
    const registry = makeRegistry();

    const systemHooks: SystemHooks = {
      preSave: [
        {
          name: "b",
          priority: 2000,
          fn: async (changes) => {
            calls.push("b");
            return changes;
          },
        },
        {
          name: "a",
          priority: 1000,
          fn: async (changes) => {
            calls.push("a");
            return changes;
          },
        },
      ],
    };

    const pipeline = createLifecycleHooks(registry, systemHooks);
    await pipeline.runPreSave("test:write:user", {}, {}, true, {});
    expect(calls).toEqual(["a", "b"]);
  });

  test("preSave abort stops pipeline", async () => {
    const registry = makeRegistry({
      preSave: [
        async () => {
          throw new Error("blocked");
        },
      ],
    });

    const pipeline = createLifecycleHooks(registry);
    await expect(pipeline.runPreSave("test:write:user", {}, {}, true, {})).rejects.toThrow(
      "blocked",
    );
  });
});

// --- PostSave pipeline ---

describe("runPostSave", () => {
  test("runs feature hooks then system hooks", async () => {
    const calls: string[] = [];
    const registry = makeRegistry({
      postSave: [
        async () => {
          calls.push("feature");
        },
      ],
    });

    const systemHooks: SystemHooks = {
      postSave: [
        {
          name: "search",
          priority: 1000,
          fn: async () => {
            calls.push("search");
          },
        },
        {
          name: "sse",
          priority: 1001,
          fn: async () => {
            calls.push("sse");
          },
        },
        {
          name: "audit",
          priority: 1002,
          fn: async () => {
            calls.push("audit");
          },
        },
      ],
    };

    const pipeline = createLifecycleHooks(registry, systemHooks);
    await pipeline.runPostSave("test:write:user", savectx, {});
    expect(calls).toEqual(["feature", "search", "sse", "audit"]);
  });

  test("postSave errors don't throw — logged and continued", async () => {
    const calls: string[] = [];
    const consoleSpy = spyOn(console, "error").mockImplementation(() => {});

    const registry = makeRegistry({
      postSave: [
        async () => {
          throw new Error("feature-fail");
        },
      ],
    });

    const systemHooks: SystemHooks = {
      postSave: [
        {
          name: "search",
          priority: 1000,
          fn: async () => {
            calls.push("search-ran");
          },
        },
      ],
    };

    const pipeline = createLifecycleHooks(registry, systemHooks);
    // Should not throw
    await pipeline.runPostSave("test:write:user", savectx, {});

    // System hook still ran despite feature hook failure
    expect(calls).toContain("search-ran");
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test("system hook failure doesn't block other system hooks", async () => {
    const calls: string[] = [];
    const consoleSpy = spyOn(console, "error").mockImplementation(() => {});

    const registry = makeRegistry();

    const systemHooks: SystemHooks = {
      postSave: [
        {
          name: "search",
          priority: 1000,
          fn: async () => {
            throw new Error("meili-down");
          },
        },
        {
          name: "sse",
          priority: 1001,
          fn: async () => {
            calls.push("sse-ran");
          },
        },
        {
          name: "audit",
          priority: 1002,
          fn: async () => {
            calls.push("audit-ran");
          },
        },
      ],
    };

    const pipeline = createLifecycleHooks(registry, systemHooks);
    await pipeline.runPostSave("test:write:user", savectx, {});

    expect(calls).toEqual(["sse-ran", "audit-ran"]);
    consoleSpy.mockRestore();
  });
});

// --- Phase routing ---
//
// runPostSave takes a phase parameter and fires ONLY hooks matching that phase.
// Error semantics also differ per phase:
//   - inTransaction hooks throw on error (to roll back the transaction)
//   - afterCommit hooks are best-effort (errors are logged, never thrown)

describe("runPostSave phase routing", () => {
  test("runs only hooks matching the given phase", async () => {
    const calls: string[] = [];
    const feature = defineFeature("phases", (r) => {
      r.entity("user", createEntity({ table: "Users", fields: {} }));
      r.writeHandler("user", z.object({}), async () => ({ isSuccess: true, data: null }), {
        access: { openToAll: true },
      });
      r.hook(
        "postSave",
        "user",
        async () => {
          calls.push("inTx");
        },
        { phase: "inTransaction" },
      );
      r.hook("postSave", "user", async () => {
        calls.push("afterCommit");
      });
    });
    const registry = createRegistry([feature]);
    const pipeline = createLifecycleHooks(registry);

    await pipeline.runPostSave("phases:write:user", savectx, {}, "inTransaction");
    expect(calls).toEqual(["inTx"]);

    calls.length = 0;
    await pipeline.runPostSave("phases:write:user", savectx, {}, "afterCommit");
    expect(calls).toEqual(["afterCommit"]);
  });

  test("inTransaction phase: hook errors throw (to roll back)", async () => {
    const feature = defineFeature("phases", (r) => {
      r.entity("user", createEntity({ table: "Users", fields: {} }));
      r.writeHandler("user", z.object({}), async () => ({ isSuccess: true, data: null }), {
        access: { openToAll: true },
      });
      r.hook(
        "postSave",
        "user",
        async () => {
          throw new Error("inTx-hook-boom");
        },
        { phase: "inTransaction" },
      );
    });
    const registry = createRegistry([feature]);
    const pipeline = createLifecycleHooks(registry);

    await expect(
      pipeline.runPostSave("phases:write:user", savectx, {}, "inTransaction"),
    ).rejects.toThrow("inTx-hook-boom");
  });

  test("afterCommit phase: hook errors are logged, never thrown", async () => {
    const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
    const afterRan: string[] = [];
    const feature = defineFeature("phases", (r) => {
      r.entity("user", createEntity({ table: "Users", fields: {} }));
      r.writeHandler("user", z.object({}), async () => ({ isSuccess: true, data: null }), {
        access: { openToAll: true },
      });
      r.hook("postSave", "user", async () => {
        throw new Error("afterCommit-boom");
      });
      r.hook("postSave", "user", async () => {
        afterRan.push("second");
      });
    });
    const registry = createRegistry([feature]);
    const pipeline = createLifecycleHooks(registry);

    // Must not throw — errors are swallowed + logged
    await pipeline.runPostSave("phases:write:user", savectx, {}, "afterCommit");

    // Subsequent hooks still fire (failure in one hook doesn't block the rest)
    expect(afterRan).toEqual(["second"]);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test("system hooks respect their phase setting", async () => {
    const feature = defineFeature("phases", (r) => {
      r.entity("user", createEntity({ table: "Users", fields: {} }));
      r.writeHandler("user", z.object({}), async () => ({ isSuccess: true, data: null }), {
        access: { openToAll: true },
      });
    });
    const registry = createRegistry([feature]);

    const calls: string[] = [];
    const systemHooks: SystemHooks = {
      postSave: [
        {
          name: "audit",
          priority: 1002,
          phase: "inTransaction",
          fn: async () => {
            calls.push("audit");
          },
        },
        {
          name: "sse",
          priority: 1001,
          phase: "afterCommit",
          fn: async () => {
            calls.push("sse");
          },
        },
      ],
    };
    const pipeline = createLifecycleHooks(registry, systemHooks);

    await pipeline.runPostSave("phases:write:user", savectx, {}, "inTransaction");
    expect(calls).toEqual(["audit"]);

    calls.length = 0;
    await pipeline.runPostSave("phases:write:user", savectx, {}, "afterCommit");
    expect(calls).toEqual(["sse"]);
  });
});

// =============================================================================
// Sprint 8a: per-tenant entity-hook filter
// =============================================================================
//
// Setup: Feature A owns the entity. Feature B registers an entity-hook
// on A's entity (cross-feature pattern). lifecycle-pipeline must filter
// B's hook based on the active tenant's effectiveFeatures-set.

describe("Sprint 8a: per-tenant entity-hook filter", () => {
  function setupTwoFeatures() {
    const calls: Array<{ tenant: string }> = [];

    const featureA = defineFeature("feat-a", (r) => {
      r.entity("widget", createEntity({ table: "Widgets", fields: { name: createTextField() } }));
      r.writeHandler(
        "widget:create",
        z.object({ name: z.string() }),
        async () => ({ isSuccess: true as const, data: null }),
        { access: { openToAll: true } },
      );
    });

    const featureB = defineFeature("feat-b", (r) => {
      r.hook("postSave", { allOf: "widget" }, async (_result, ctx) => {
        calls.push({ tenant: ctx._tenantId ?? "no-tenant" });
      });
    });

    return { registry: createRegistry([featureA, featureB]), calls };
  }

  const tenantA = "00000000-0000-4000-8000-0000000000a1" as TenantId;
  const tenantB = "00000000-0000-4000-8000-0000000000b2" as TenantId;

  const baseSaveCtx: SaveContext = {
    kind: "save",
    id: 1,
    data: { name: "x", tenantId: tenantA },
    changes: { name: "x" },
    previous: {},
    isNew: true,
    entityName: "widget",
  };

  test("Tenant A (feat-b enabled) → hook fires; Tenant B (feat-b disabled) → hook skipped", async () => {
    const { registry, calls } = setupTwoFeatures();
    const pipeline = createLifecycleHooks(registry);
    const effectiveFeatures = (tenantId: TenantId) =>
      tenantId === tenantA ? new Set(["feat-a", "feat-b"]) : new Set(["feat-a"]);

    await pipeline.runPostSave("feat-a:write:widget:create", baseSaveCtx, {
      _tenantId: tenantA,
      effectiveFeatures,
    });
    await pipeline.runPostSave("feat-a:write:widget:create", baseSaveCtx, {
      _tenantId: tenantB,
      effectiveFeatures,
    });

    expect(calls).toEqual([{ tenant: tenantA }]);
  });

  test("ctx without _tenantId → hook fires (legacy back-compat: undefined = skip filter)", async () => {
    // System-jobs / boot-time pipeline-calls have no user → no _tenantId.
    // currentEffectiveFeatures returns undefined; registry filterByPhase
    // treats undefined as "skip filter" → all hooks fire (back-compat).
    const { registry, calls } = setupTwoFeatures();
    const pipeline = createLifecycleHooks(registry);

    await pipeline.runPostSave("feat-a:write:widget:create", baseSaveCtx, {});

    expect(calls).toHaveLength(1);
    expect(calls[0]?.tenant).toBe("no-tenant");
  });

  test("effectiveFeatures wird PRO call konsultiert (kein staler Cache zwischen runPostSave-aufrufen)", async () => {
    // Pin: currentEffectiveFeatures-helper ruft effectiveFeatures jedes
    // mal neu — keine pipeline-internal Memoization. Toggle-flips müssen
    // sofort greifen, nicht erst nach pipeline-restart.
    const { registry, calls } = setupTwoFeatures();
    const pipeline = createLifecycleHooks(registry);
    const enabled = new Set<string>(["feat-a", "feat-b"]);
    const effectiveFeatures = (_tenantId: TenantId) => enabled;

    await pipeline.runPostSave("feat-a:write:widget:create", baseSaveCtx, {
      _tenantId: tenantA,
      effectiveFeatures,
    });
    enabled.delete("feat-b");
    await pipeline.runPostSave("feat-a:write:widget:create", baseSaveCtx, {
      _tenantId: tenantA,
      effectiveFeatures,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.tenant).toBe(tenantA);
  });
});

describe("buildEventId — dedup key construction", () => {
  test("includes handler, id, version and phase when payload is complete", () => {
    const payload = { id: 42, data: { version: 3 } };
    expect(buildEventId("users:write:user:create", payload, "postSave:afterCommit")).toBe(
      "users:write:user:create:42:3:postSave:afterCommit",
    );
  });

  test("falls back to version 0 when payload has no data.version", () => {
    const payload = { id: 42 };
    expect(buildEventId("handler", payload, "phase")).toBe("handler:42:0:phase");
  });

  test("returns null when payload is not an object (no dedup possible)", () => {
    expect(buildEventId("handler", null, "phase")).toBeNull();
    expect(buildEventId("handler", undefined, "phase")).toBeNull();
    expect(buildEventId("handler", "string", "phase")).toBeNull();
    expect(buildEventId("handler", 123, "phase")).toBeNull();
  });

  test("returns null when payload has no id — triggers the warn-log path in runHookSet", () => {
    expect(buildEventId("handler", {}, "phase")).toBeNull();
    expect(buildEventId("handler", { data: { version: 5 } }, "phase")).toBeNull();
    // id=0 is also treated as absent: serial PKs start at 1, so 0 means
    // "never inserted" — safer to skip dedup than to collide on a sentinel.
    expect(buildEventId("handler", { id: 0 }, "phase")).toBeNull();
  });
});

// --- PreDelete / PostDelete pipeline ---

const deletectx: DeleteContext = {
  kind: "delete",
  id: 1,
  data: { email: "test@test.de" },
  entityName: "user",
};

describe("runPreDelete", () => {
  test("runs feature + entity + system hooks, all inTransaction (throw on error)", async () => {
    const calls: string[] = [];
    const feature = defineFeature("test", (r) => {
      r.entity("user", createEntity({ table: "Users", fields: { email: createTextField() } }));
      r.writeHandler("user", z.object({}), async () => ({ isSuccess: true as const, data: null }), {
        access: { openToAll: true },
      });
      r.hook("preDelete", "user", async () => {
        calls.push("handler");
      });
      r.hook("preDelete", { allOf: "user" }, async () => {
        calls.push("entity");
      });
    });
    const registry = createRegistry([feature]);
    const systemHooks: SystemHooks = {
      preDelete: [
        {
          name: "sys",
          priority: 1000,
          fn: async () => {
            calls.push("system");
          },
        },
      ],
    };
    const pipeline = createLifecycleHooks(registry, systemHooks);
    await pipeline.runPreDelete("test:write:user", deletectx, {});
    expect(calls).toEqual(["handler", "entity", "system"]);
  });

  test("a hook throwing aborts the delete (rejects, not swallowed)", async () => {
    const feature = defineFeature("test", (r) => {
      r.entity("user", createEntity({ table: "Users", fields: { email: createTextField() } }));
      r.writeHandler("user", z.object({}), async () => ({ isSuccess: true as const, data: null }), {
        access: { openToAll: true },
      });
      r.hook("preDelete", "user", async () => {
        throw new Error("blocked-delete");
      });
    });
    const registry = createRegistry([feature]);
    const pipeline = createLifecycleHooks(registry);
    await expect(pipeline.runPreDelete("test:write:user", deletectx, {})).rejects.toThrow(
      "blocked-delete",
    );
  });

  test("system hook with a non-inTransaction phase is skipped", async () => {
    const registry = makeRegistry();
    const calls: string[] = [];
    const systemHooks: SystemHooks = {
      preDelete: [
        {
          name: "sys",
          priority: 1000,
          phase: "afterCommit",
          fn: async () => {
            calls.push("system");
          },
        },
      ],
    };
    const pipeline = createLifecycleHooks(registry, systemHooks);
    await pipeline.runPreDelete("test:write:user", deletectx, {});
    expect(calls).toEqual([]);
  });
});

describe("runPostDelete", () => {
  test("runs feature then system hooks (best-effort by default phase)", async () => {
    const calls: string[] = [];
    const feature = defineFeature("test", (r) => {
      r.entity("user", createEntity({ table: "Users", fields: { email: createTextField() } }));
      r.writeHandler("user", z.object({}), async () => ({ isSuccess: true as const, data: null }), {
        access: { openToAll: true },
      });
      r.hook("postDelete", "user", async () => {
        calls.push("feature");
      });
    });
    const registry = createRegistry([feature]);
    const systemHooks: SystemHooks = {
      postDelete: [
        {
          name: "sys",
          priority: 1000,
          fn: async () => {
            calls.push("system");
          },
        },
      ],
    };
    const pipeline = createLifecycleHooks(registry, systemHooks);
    await pipeline.runPostDelete("test:write:user", deletectx, {});
    expect(calls).toEqual(["feature", "system"]);
  });

  test("inTransaction phase: hook errors throw", async () => {
    const feature = defineFeature("test", (r) => {
      r.entity("user", createEntity({ table: "Users", fields: { email: createTextField() } }));
      r.writeHandler("user", z.object({}), async () => ({ isSuccess: true as const, data: null }), {
        access: { openToAll: true },
      });
      r.hook(
        "postDelete",
        "user",
        async () => {
          throw new Error("postDelete-inTx-boom");
        },
        { phase: "inTransaction" },
      );
    });
    const registry = createRegistry([feature]);
    const pipeline = createLifecycleHooks(registry);
    await expect(
      pipeline.runPostDelete("test:write:user", deletectx, {}, "inTransaction"),
    ).rejects.toThrow("postDelete-inTx-boom");
  });
});

// --- Batch hooks ---

describe("runPostSaveBatch / runPostDeleteBatch", () => {
  test("no batch hooks registered → resolves without throwing", async () => {
    const pipeline = createLifecycleHooks(makeRegistry());
    await expect(pipeline.runPostSaveBatch([savectx], {})).resolves.toBeUndefined();
    await expect(pipeline.runPostDeleteBatch([deletectx], {})).resolves.toBeUndefined();
    // Should not throw — nothing registered.
  });

  test("runPostSaveBatch runs all system hooks concurrently with the batch payload", async () => {
    const seen: (readonly SaveContext[])[] = [];
    const systemHooks: SystemHooks = {
      postSaveBatch: [
        {
          name: "a",
          priority: 1000,
          fn: async (results) => {
            seen.push(results);
          },
        },
      ],
    };
    const pipeline = createLifecycleHooks(makeRegistry(), systemHooks);
    await pipeline.runPostSaveBatch([savectx], {});
    expect(seen).toEqual([[savectx]]);
  });

  test("runPostDeleteBatch runs all system hooks with the batch payload", async () => {
    const seen: (readonly DeleteContext[])[] = [];
    const systemHooks: SystemHooks = {
      postDeleteBatch: [
        {
          name: "a",
          priority: 1000,
          fn: async (payloads) => {
            seen.push(payloads);
          },
        },
      ],
    };
    const pipeline = createLifecycleHooks(makeRegistry(), systemHooks);
    await pipeline.runPostDeleteBatch([deletectx], {});
    expect(seen).toEqual([[deletectx]]);
  });

  test.each([
    [
      "postSaveBatch",
      (hooks: { name: string; priority: number; fn: () => Promise<void> }[]) =>
        ({ postSaveBatch: hooks }) satisfies SystemHooks,
      (pipeline: ReturnType<typeof createLifecycleHooks>) =>
        pipeline.runPostSaveBatch([savectx], {}),
    ],
    [
      "postDeleteBatch",
      (hooks: { name: string; priority: number; fn: () => Promise<void> }[]) =>
        ({ postDeleteBatch: hooks }) satisfies SystemHooks,
      (pipeline: ReturnType<typeof createLifecycleHooks>) =>
        pipeline.runPostDeleteBatch([deletectx], {}),
    ],
  ])("one %s hook throwing doesn't stop the others (Promise.allSettled) — logged, never thrown", async (_name, buildHooks, run) => {
    const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
    const calls: string[] = [];
    const systemHooks = buildHooks([
      {
        name: "failing",
        priority: 1000,
        fn: async () => {
          throw new Error("batch-hook-boom");
        },
      },
      {
        name: "ok",
        priority: 1001,
        fn: async () => {
          calls.push("ok-ran");
        },
      },
    ]);
    const pipeline = createLifecycleHooks(makeRegistry(), systemHooks);
    // Must not throw.
    await run(pipeline);
    expect(calls).toEqual(["ok-ran"]);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
