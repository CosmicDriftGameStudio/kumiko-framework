import { describe, expect, test } from "vitest";
import { createEntity, createRegistry, defineFeature } from "../index";
import type { PostSaveHookFn, PreDeleteHookFn, PreSaveHookFn, SaveContext } from "../types";

describe("lifecycle hook registration", () => {
  test("preSave hooks are registered", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("user", createEntity({ table: "Users", fields: {} }));
      r.hook("preSave", "user", async (changes) => {
        changes["email"] = (changes["email"] as string).toLowerCase();
        return changes;
      });
    });

    expect(Object.keys(feature.hooks.preSave)).toContain("user");
  });

  test("postSave hooks are registered", () => {
    const feature = defineFeature("test", (r) => {
      r.hook("postSave", "user", async () => {});
    });

    expect(Object.keys(feature.hooks.postSave)).toContain("user");
  });

  test("preDelete hooks are registered", () => {
    const feature = defineFeature("test", (r) => {
      r.hook("preDelete", "user", async () => {});
    });

    expect(Object.keys(feature.hooks.preDelete)).toContain("user");
  });

  test("postDelete hooks are registered", () => {
    const feature = defineFeature("test", (r) => {
      r.hook("postDelete", "user", async () => {});
    });

    expect(Object.keys(feature.hooks.postDelete)).toContain("user");
  });

  test("multiple hooks on same entity are collected in order", () => {
    const feature = defineFeature("test", (r) => {
      r.hook("preSave", "user", async (changes) => changes);
      r.hook("preSave", "user", async (changes) => changes);
    });

    const hooks = feature.hooks.preSave["user"];
    expect(hooks).toHaveLength(2);
  });

  test("validation hooks still work alongside lifecycle hooks", () => {
    const feature = defineFeature("test", (r) => {
      r.hook("validation", "userForm", () => null);
      r.hook("preSave", "user", async (changes) => changes);
      r.hook("postSave", "user", async () => {});
    });

    expect(feature.hooks.validation["userForm"]).toBeDefined();
    expect(feature.hooks.preSave["user"]).toHaveLength(1);
    expect(feature.hooks.postSave["user"]).toHaveLength(1);
  });
});

describe("lifecycle hooks in registry", () => {
  test("merges preSave hooks across features", () => {
    const f1 = defineFeature("a", (r) => {
      r.entity("user", createEntity({ table: "Users", fields: {} }));
      r.hook("preSave", "user", async (changes) => changes);
    });
    const f2 = defineFeature("b", (r) => {
      r.hook("preSave", "user", async (changes) => changes);
    });

    const registry = createRegistry([f1, f2]);
    expect(registry.getPreSaveHooks("user")).toHaveLength(2);
  });

  test("merges postSave hooks across features", () => {
    const f1 = defineFeature("a", (r) => {
      r.entity("user", createEntity({ table: "Users", fields: {} }));
      r.hook("postSave", "user", async () => {});
    });
    const f2 = defineFeature("b", (r) => {
      r.hook("postSave", "user", async () => {});
      r.hook("postSave", "user", async () => {});
    });

    const registry = createRegistry([f1, f2]);
    expect(registry.getPostSaveHooks("user")).toHaveLength(3);
  });

  test("returns empty array for entity without hooks", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("user", createEntity({ table: "Users", fields: {} }));
    });

    const registry = createRegistry([feature]);
    expect(registry.getPreSaveHooks("user")).toEqual([]);
    expect(registry.getPostSaveHooks("user")).toEqual([]);
    expect(registry.getPreDeleteHooks("user")).toEqual([]);
    expect(registry.getPostDeleteHooks("user")).toEqual([]);
    expect(registry.getPreQueryHooks("user")).toEqual([]);
  });
});

describe("preSave hook behavior", () => {
  test("preSave receives changes and can modify them", async () => {
    const hook: PreSaveHookFn = async (changes, ctx) => {
      expect(ctx.isNew).toBe(false);
      expect(ctx.previous["email"]).toBe("old@test.de");
      return { ...changes, email: (changes["email"] as string).toLowerCase() };
    };

    const result = await hook(
      { email: "MARC@TEST.DE" },
      { previous: { email: "old@test.de" }, isNew: false },
    );
    expect(result["email"]).toBe("marc@test.de");
  });

  test("preSave knows if it is a create (isNew=true)", async () => {
    let wasNew: boolean | undefined;
    const hook: PreSaveHookFn = async (changes, ctx) => {
      wasNew = ctx.isNew;
      return changes;
    };

    await hook({}, { previous: {}, isNew: true });
    expect(wasNew).toBe(true);
  });

  test("preSave can abort by throwing", async () => {
    const hook: PreSaveHookFn = async () => {
      throw new Error("blocked_by_policy");
    };

    await expect(hook({}, { previous: {}, isNew: false })).rejects.toThrow("blocked_by_policy");
  });
});

describe("postSave hook behavior", () => {
  test("postSave receives full SaveContext with changes and previous", async () => {
    let received: SaveContext | undefined;
    const hook: PostSaveHookFn = async (result) => {
      received = result;
    };

    await hook(
      {
        id: 42,
        data: { email: "new@test.de", status: "Started" },
        changes: { status: "Started" },
        previous: { email: "new@test.de", status: "Draft" },
        isNew: false,
      },
      {},
    );

    expect(received?.id).toBe(42);
    expect(received?.changes["status"]).toBe("Started");
    expect(received?.previous["status"]).toBe("Draft");
    expect(received?.isNew).toBe(false);
  });

  test("postSave: detect status transition for email trigger", async () => {
    let shouldSendEmail = false;

    const hook: PostSaveHookFn = async (result) => {
      if (result.changes["status"] === "Started" && result.previous["status"] !== "Started") {
        shouldSendEmail = true;
      }
    };

    // First time: Draft → Started → send email
    await hook(
      {
        id: 1,
        data: {},
        changes: { status: "Started" },
        previous: { status: "Draft" },
        isNew: false,
      },
      {},
    );
    expect(shouldSendEmail).toBe(true);

    // Second save: Started → Started (no change) → no email
    shouldSendEmail = false;
    await hook(
      {
        id: 1,
        data: {},
        changes: { status: "Started" },
        previous: { status: "Started" },
        isNew: false,
      },
      {},
    );
    expect(shouldSendEmail).toBe(false);
  });
});

describe("preDelete hook behavior", () => {
  test("preDelete receives full entity data before deletion", async () => {
    let receivedData: Record<string, unknown> | undefined;
    const hook: PreDeleteHookFn = async (payload) => {
      receivedData = payload.data as Record<string, unknown>;
    };

    await hook({ id: 1, data: { email: "delete-me@test.de", hasOrders: true } }, {});
    expect(receivedData?.["email"]).toBe("delete-me@test.de");
  });

  test("preDelete can abort by throwing", async () => {
    const hook: PreDeleteHookFn = async (payload) => {
      if (payload.data["hasOrders"]) throw new Error("has_dependencies");
    };

    await expect(hook({ id: 1, data: { hasOrders: true } }, {})).rejects.toThrow(
      "has_dependencies",
    );
  });
});
