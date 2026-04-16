import { describe, expect, test } from "vitest";
import { createEntity, createRegistry, createTextField, defineFeature } from "../../engine";

describe("getIncomingRelations", () => {
  const feature = defineFeature("core", (r) => {
    r.entity(
      "department",
      createEntity({ table: "Departments", fields: { name: createTextField() } }),
    );
    r.entity("user", createEntity({ table: "Users", fields: { departmentId: createTextField() } }));
    r.entity("session", createEntity({ table: "Sessions", fields: { userId: createTextField() } }));

    r.relation("department", "users", {
      type: "hasMany",
      target: "user",
      foreignKey: "departmentId",
      onDelete: "restrict",
    });
    r.relation("user", "sessions", {
      type: "hasMany",
      target: "session",
      foreignKey: "userId",
      onDelete: "cascade",
    });
  });

  const registry = createRegistry([feature]);

  test("finds hasMany relation pointing to user from department", () => {
    const incoming = registry.getIncomingRelations("user");
    expect(
      incoming.some((r) => r.sourceEntity === "department" && r.relation.onDelete === "restrict"),
    ).toBe(true);
  });

  test("finds hasMany relation pointing to session from user", () => {
    const incoming = registry.getIncomingRelations("session");
    expect(incoming).toHaveLength(1);
    expect(incoming[0]?.relation.onDelete).toBe("cascade");
  });

  test("no incoming relations for department", () => {
    expect(registry.getIncomingRelations("department")).toEqual([]);
  });

  test("onDelete strategy preserved", () => {
    const rels = registry.getRelations("department");
    expect(rels["users"]?.onDelete).toBe("restrict");
  });
});
