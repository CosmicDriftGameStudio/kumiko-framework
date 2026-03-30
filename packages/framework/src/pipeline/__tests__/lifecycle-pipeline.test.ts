import { describe, expect, test, vi } from "vitest";
import {
  createEntity,
  createRegistry,
  createTextField,
  defineFeature,
  type PostSaveHookFn,
  type PreSaveHookFn,
  type SaveContext,
} from "../../engine";
import { createLifecyclePipeline, type SystemHooks } from "../lifecycle-pipeline";

function makeRegistry(hooks?: { preSave?: PreSaveHookFn[]; postSave?: PostSaveHookFn[] }) {
  const feature = defineFeature("test", (r) => {
    r.entity("user", createEntity({ table: "Users", fields: { email: createTextField() } }));
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

    const pipeline = createLifecyclePipeline(registry);
    await pipeline.runPreSave("user", { email: "x" }, {}, true, {});
    expect(calls).toEqual(["a", "b"]);
  });

  test("feature hooks can modify changes", async () => {
    const registry = makeRegistry({
      preSave: [
        async (changes) => ({ ...changes, email: (changes["email"] as string).toLowerCase() }),
      ],
    });

    const pipeline = createLifecyclePipeline(registry);
    const result = await pipeline.runPreSave("user", { email: "MARC@TEST.DE" }, {}, true, {});
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

    const pipeline = createLifecyclePipeline(registry, systemHooks);
    await pipeline.runPreSave("user", {}, {}, true, {});
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

    const pipeline = createLifecyclePipeline(registry, systemHooks);
    await pipeline.runPreSave("user", {}, {}, true, {});
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

    const pipeline = createLifecyclePipeline(registry);
    await expect(pipeline.runPreSave("user", {}, {}, true, {})).rejects.toThrow("blocked");
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

    const pipeline = createLifecyclePipeline(registry, systemHooks);
    await pipeline.runPostSave("user", savectx, {});
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

    const pipeline = createLifecyclePipeline(registry, systemHooks);
    // Should not throw
    await pipeline.runPostSave("user", savectx, {});

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

    const pipeline = createLifecyclePipeline(registry, systemHooks);
    await pipeline.runPostSave("user", savectx, {});

    expect(calls).toEqual(["sse-ran", "audit-ran"]);
    consoleSpy.mockRestore();
  });
});
