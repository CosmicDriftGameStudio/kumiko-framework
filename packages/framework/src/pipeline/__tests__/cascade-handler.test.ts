import { describe, expect, test } from "vitest";
import {
  createEntity,
  createNumberField,
  createRegistry,
  createTextField,
  defineFeature,
  type Registry,
} from "../../engine";

describe("cascade delete — registry.getIncomingRelations", () => {
  function setupRegistry(): Registry {
    const f1 = defineFeature("core", (r) => {
      r.entity(
        "department",
        createEntity({ table: "Departments", fields: { name: createTextField() } }),
      );
      r.entity(
        "user",
        createEntity({ table: "Users", fields: { departmentId: createNumberField() } }),
      );
      r.entity("role", createEntity({ table: "Roles", fields: { name: createTextField() } }));
      r.entity(
        "session",
        createEntity({ table: "Sessions", fields: { userId: createNumberField() } }),
      );

      // user belongs to department
      r.relation("user", "department", {
        type: "belongsTo",
        target: "department",
        foreignKey: "departmentId",
        onDelete: "setNull",
      });

      // department has many users
      r.relation("department", "users", {
        type: "hasMany",
        target: "user",
        foreignKey: "departmentId",
        onDelete: "setNull",
      });

      // user has many sessions — cascade delete
      r.relation("user", "sessions", {
        type: "hasMany",
        target: "session",
        foreignKey: "userId",
        onDelete: "cascade",
      });

      // user <-> role — restrict delete
      r.relation("user", "roles", {
        type: "manyToMany",
        target: "role",
        through: { table: "UserRoles", sourceKey: "userId", targetKey: "roleId" },
        onDelete: "restrict",
      });
    });

    return createRegistry([f1]);
  }

  test("getIncomingRelations finds relations pointing TO entity", () => {
    const registry = setupRegistry();

    // Who references "user"?
    const incoming = registry.getIncomingRelations("user");
    // department.users (hasMany, target: user)
    expect(
      incoming.some((r) => r.sourceEntity === "department" && r.relationName === "users"),
    ).toBe(true);
  });

  test("getIncomingRelations for department finds user.department", () => {
    const registry = setupRegistry();

    const incoming = registry.getIncomingRelations("department");
    expect(incoming.some((r) => r.sourceEntity === "user" && r.relationName === "department")).toBe(
      true,
    );
  });

  test("getIncomingRelations for role finds user.roles manyToMany", () => {
    const registry = setupRegistry();

    const incoming = registry.getIncomingRelations("role");
    expect(
      incoming.some((r) => r.sourceEntity === "user" && r.relation.type === "manyToMany"),
    ).toBe(true);
  });

  test("getIncomingRelations for session finds user.sessions cascade", () => {
    const registry = setupRegistry();
    const incoming = registry.getIncomingRelations("session");
    expect(incoming).toHaveLength(1);
    expect(incoming[0]?.sourceEntity).toBe("user");
    expect(incoming[0]?.relation.onDelete).toBe("cascade");
  });

  test("getIncomingRelations for entity with no references returns empty", () => {
    const feature = defineFeature("isolated", (r) => {
      r.entity("orphan", createEntity({ table: "Orphans", fields: {} }));
    });
    const registry = createRegistry([feature]);
    expect(registry.getIncomingRelations("orphan")).toEqual([]);
  });

  test("onDelete strategy is preserved on relation", () => {
    const registry = setupRegistry();

    const rels = registry.getRelations("user");
    expect(rels["sessions"]?.onDelete).toBe("cascade");
    expect(rels["roles"]?.onDelete).toBe("restrict");
    expect(rels["department"]?.onDelete).toBe("setNull");
  });

  test("onDelete defaults to nothing when not specified", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("a", createEntity({ table: "A", fields: {} }));
      r.entity("b", createEntity({ table: "B", fields: {} }));
      r.relation("a", "bs", {
        type: "hasMany",
        target: "b",
        foreignKey: "aId",
        // no onDelete
      });
    });

    const registry = createRegistry([feature]);
    const rels = registry.getRelations("a");
    expect(rels["bs"]?.onDelete).toBeUndefined(); // defaults to "nothing" in handler
  });
});
