import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import {
  createEntity,
  createRegistry,
  createTextField,
  defineFeature,
  type PostSaveHookFn,
  type PreSaveHookFn,
  type SaveContext,
} from "../../engine";
import { createLifecycleHooks, type SystemHooks } from "../lifecycle-pipeline";

function makeRegistry(hooks?: { preSave?: PreSaveHookFn[]; postSave?: PostSaveHookFn[] }) {
  const feature = defineFeature("test", (r) => {
    r.entity("user", createEntity({ table: "Users", fields: { email: createTextField() } }));
    // Dummy handler so hook targets resolve (boot validation requires it)
    r.writeHandler("user", z.object({}), async () => ({ isSuccess: true as const, data: null }));
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
  data: { email: "test@test.de", tenantId: 1 },
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
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

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
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

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
      r.writeHandler("user", z.object({}), async () => ({ isSuccess: true, data: null }));
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
      r.writeHandler("user", z.object({}), async () => ({ isSuccess: true, data: null }));
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
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const afterRan: string[] = [];
    const feature = defineFeature("phases", (r) => {
      r.entity("user", createEntity({ table: "Users", fields: {} }));
      r.writeHandler("user", z.object({}), async () => ({ isSuccess: true, data: null }));
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
      r.writeHandler("user", z.object({}), async () => ({ isSuccess: true, data: null }));
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
