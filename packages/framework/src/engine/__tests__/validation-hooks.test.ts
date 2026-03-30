import { describe, expect, test } from "vitest";
import { createEntity, createRegistry, createTextField, defineFeature } from "../index";
import type { ValidationError } from "../validation";
import { runValidation } from "../validation";

describe("validation hooks", () => {
  test("r.hook registers validation hook", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("user", createEntity({ table: "Users", fields: { email: createTextField() } }));
      r.hook("validation", "userForm", (data) => {
        const errors: ValidationError[] = [];
        if (!data["email"]) errors.push({ field: "email", error: "required" });
        return errors.length > 0 ? errors : null;
      });
    });

    expect(feature.hooks["validation"]).toBeDefined();
    expect(feature.hooks["validation"]?.["userForm"]).toBeDefined();
  });

  test("runValidation returns null when valid", () => {
    const feature = defineFeature("test", (r) => {
      r.hook("validation", "userForm", () => null);
    });

    const registry = createRegistry([feature]);
    const result = runValidation(registry, "userForm", { email: "a@b.de" });
    expect(result).toBeNull();
  });

  test("runValidation returns errors when invalid", () => {
    const feature = defineFeature("test", (r) => {
      r.hook("validation", "userForm", (data) => {
        if (!data["email"]) return [{ field: "email", error: "required" }];
        return null;
      });
    });

    const registry = createRegistry([feature]);
    const result = runValidation(registry, "userForm", {});
    expect(result).toEqual([{ field: "email", error: "required" }]);
  });

  test("runValidation collects errors from multiple features", () => {
    const f1 = defineFeature("a", (r) => {
      r.hook("validation", "sharedForm", (data) => {
        if (!data["name"]) return [{ field: "name", error: "required" }];
        return null;
      });
    });
    const f2 = defineFeature("b", (r) => {
      r.hook("validation", "sharedForm", (data) => {
        if (!data["age"]) return [{ field: "age", error: "required" }];
        return null;
      });
    });

    const registry = createRegistry([f1, f2]);
    const result = runValidation(registry, "sharedForm", {});
    expect(result).toEqual([
      { field: "name", error: "required" },
      { field: "age", error: "required" },
    ]);
  });

  test("runValidation returns null for unknown hook", () => {
    const feature = defineFeature("test", () => {});
    const registry = createRegistry([feature]);
    expect(runValidation(registry, "nonexistent", {})).toBeNull();
  });
});
