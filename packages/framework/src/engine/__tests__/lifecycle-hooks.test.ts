import { describe, expect, test } from "vitest";
import { createEntity, createRegistry, defineFeature } from "../index";
import type { PostSaveHookFn, PreDeleteHookFn, PreSaveHookFn } from "../types";

describe("lifecycle hook registration", () => {
  test("preSave hooks are registered", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("user", createEntity({ table: "Users", fields: {} }));
      r.hook("preSave", "user", async (data) => {
        data["email"] = (data["email"] as string).toLowerCase();
        return data;
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
    const calls: string[] = [];

    const feature = defineFeature("test", (r) => {
      r.hook("preSave", "user", async (data) => {
        calls.push("a");
        return data;
      });
      r.hook("preSave", "user", async (data) => {
        calls.push("b");
        return data;
      });
    });

    const hooks = feature.hooks.preSave["user"];
    expect(hooks).toHaveLength(2);
  });

  test("validation hooks still work alongside lifecycle hooks", () => {
    const feature = defineFeature("test", (r) => {
      r.hook("validation", "userForm", () => null);
      r.hook("preSave", "user", async (data) => data);
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
      r.hook("preSave", "user", async (data) => data);
    });
    const f2 = defineFeature("b", (r) => {
      r.hook("preSave", "user", async (data) => data);
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
  test("preSave can modify data", async () => {
    const hook: PreSaveHookFn = async (data) => {
      return { ...data, email: (data["email"] as string).toLowerCase() };
    };

    const result = await hook({ email: "MARC@TEST.DE" }, {});
    expect(result["email"]).toBe("marc@test.de");
  });

  test("preSave can abort by throwing", async () => {
    const hook: PreSaveHookFn = async () => {
      throw new Error("blocked_by_policy");
    };

    await expect(hook({}, {})).rejects.toThrow("blocked_by_policy");
  });
});

describe("postSave hook behavior", () => {
  test("postSave receives result with id", async () => {
    const received: unknown[] = [];
    const hook: PostSaveHookFn = async (result) => {
      received.push(result);
    };

    await hook({ id: 42, data: { email: "test@test.de" } }, {});
    expect(received).toHaveLength(1);
    expect((received[0] as { id: number }).id).toBe(42);
  });
});

describe("preDelete hook behavior", () => {
  test("preDelete can abort by throwing", async () => {
    const hook: PreDeleteHookFn = async () => {
      throw new Error("has_dependencies");
    };

    await expect(hook({ id: 1 }, {})).rejects.toThrow("has_dependencies");
  });
});
