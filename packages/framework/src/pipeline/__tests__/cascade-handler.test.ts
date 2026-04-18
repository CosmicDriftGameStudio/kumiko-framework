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
    const match = incoming.find(
      (r) => r.sourceEntity === "department" && r.relation.type === "hasMany",
    );
    expect(match?.relation.type === "hasMany" && match.relation.onDelete).toBe("restrict");
  });

  test("finds hasMany relation pointing to session from user", () => {
    const incoming = registry.getIncomingRelations("session");
    expect(incoming).toHaveLength(1);
    const rel = incoming[0]?.relation;
    expect(rel?.type === "hasMany" && rel.onDelete).toBe("cascade");
  });

  test("no incoming relations for department", () => {
    expect(registry.getIncomingRelations("department")).toEqual([]);
  });

  test("onDelete strategy preserved", () => {
    const rel = registry.getRelations("department")["users"];
    expect(rel?.type === "hasMany" && rel.onDelete).toBe("restrict");
  });
});
