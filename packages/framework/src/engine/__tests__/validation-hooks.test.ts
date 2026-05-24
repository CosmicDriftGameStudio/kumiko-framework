import { describe, expect, test } from "bun:test";
import { createEntity, createRegistry, createTextField, defineFeature } from "../index";
import type { ValidationError } from "../validation";
import { runValidation } from "../validation";

describe("validation hooks", () => {
  test("r.hook registers validation hook", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("user", createEntity({ table: "Users", fields: { email: createTextField() } }));
      r.hook("validation", "user:create", (data) => {
        const errors: ValidationError[] = [];
        if (!data["email"]) errors.push({ field: "email", error: "required" });
        return errors.length > 0 ? errors : null;
      });
    });

    expect(feature.hooks["validation"]).toBeDefined();
    expect(feature.hooks["validation"]?.["user:create"]).toBeDefined();
  });

  test("runValidation returns null when valid", () => {
    const feature = defineFeature("test", (r) => {
      r.hook("validation", "user:create", () => null);
    });

    const registry = createRegistry([feature]);
    const result = runValidation(registry, "test:write:user:create", { email: "a@b.de" });
    expect(result).toBeNull();
  });

  test("runValidation returns errors when invalid", () => {
    const feature = defineFeature("test", (r) => {
      r.hook("validation", "user:create", (data) => {
        if (!data["email"]) return [{ field: "email", error: "required" }];
        return null;
      });
    });

    const registry = createRegistry([feature]);
    const result = runValidation(registry, "test:write:user:create", {});
    expect(result).toEqual([{ field: "email", error: "required" }]);
  });

  test("runValidation scoped to feature", () => {
    const f1 = defineFeature("a", (r) => {
      r.hook("validation", "task:create", (data) => {
        if (!data["name"]) return [{ field: "name", error: "required" }];
        return null;
      });
    });
    const f2 = defineFeature("b", (r) => {
      r.hook("validation", "task:create", (data) => {
        if (!data["age"]) return [{ field: "age", error: "required" }];
        return null;
      });
    });

    const registry = createRegistry([f1, f2]);
    const resultA = runValidation(registry, "a:write:task:create", {});
    expect(resultA).toEqual([{ field: "name", error: "required" }]);

    const resultB = runValidation(registry, "b:write:task:create", {});
    expect(resultB).toEqual([{ field: "age", error: "required" }]);
  });

  test("runValidation returns null for unknown hook", () => {
    const feature = defineFeature("test", () => {});
    const registry = createRegistry([feature]);
    expect(runValidation(registry, "test:write:nonexistent", {})).toBeNull();
  });
});
