import { describe, expect, test } from "vitest";
import {
  createEntity,
  createNumberField,
  createRegistry,
  createTextField,
  defineFeature,
} from "../../engine";

describe("getIncomingRelations", () => {
  const feature = defineFeature("core", (r) => {
    r.entity(
      "department",
      createEntity({ table: "Departments", fields: { name: createTextField() } }),
    );
    r.entity(
      "user",
      createEntity({ table: "Users", fields: { departmentId: createNumberField() } }),
    );
    r.entity(
      "session",
      createEntity({ table: "Sessions", fields: { userId: createNumberField() } }),
    );

    r.relation("department", "users", {
      type: "hasMany",
      target: "core.user",
      foreignKey: "departmentId",
      onDelete: "restrict",
    });
    r.relation("user", "sessions", {
      type: "hasMany",
      target: "core.session",
      foreignKey: "userId",
      onDelete: "cascade",
    });
  });

  const registry = createRegistry([feature]);

  test("finds hasMany relation pointing to user from department", () => {
    const incoming = registry.getIncomingRelations("core.user");
    expect(
      incoming.some((r) => r.sourceEntity === "core.department" && r.relation.onDelete === "restrict"),
    ).toBe(true);
  });

  test("finds hasMany relation pointing to session from user", () => {
    const incoming = registry.getIncomingRelations("core.session");
    expect(incoming).toHaveLength(1);
    expect(incoming[0]?.relation.onDelete).toBe("cascade");
  });

  test("no incoming relations for department", () => {
    expect(registry.getIncomingRelations("core.department")).toEqual([]);
  });

  test("onDelete strategy preserved", () => {
    const rels = registry.getRelations("core.department");
    expect(rels["users"]?.onDelete).toBe("restrict");
  });
});
