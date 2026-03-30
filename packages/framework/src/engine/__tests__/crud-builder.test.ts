import { describe, expect, test } from "vitest";
import { createBooleanField, createEntity, createTextField, defineFeature } from "../index";

// --- r.crud() registration ---

describe("r.crud()", () => {
  const userEntity = createEntity({
    table: "Users",
    fields: {
      email: createTextField({ required: true, format: "email", searchable: true }),
      firstName: createTextField(),
      lastName: createTextField({ searchable: true }),
      isEnabled: createBooleanField({ default: true }),
    },
  });

  test("registers all 5 handlers", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("post", createEntity({ table: "Posts", fields: {} }));
      r.crud("post");
    });

    expect(feature.writeHandlers["post.create"]).toBeDefined();
    expect(feature.writeHandlers["post.update"]).toBeDefined();
    expect(feature.writeHandlers["post.delete"]).toBeDefined();
    expect(feature.queryHandlers["post.list"]).toBeDefined();
    expect(feature.queryHandlers["post.detail"]).toBeDefined();
  });

  test("create handler validates with insert schema", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("user", userEntity);
      r.crud("user");
    });

    const createHandler = feature.writeHandlers["user.create"];
    // Required email must be present
    expect(createHandler?.schema.safeParse({ email: "a@b.de" }).success).toBe(true);
    // Missing required field fails
    expect(createHandler?.schema.safeParse({}).success).toBe(false);
    // Invalid email fails
    expect(createHandler?.schema.safeParse({ email: "nope" }).success).toBe(false);
  });

  test("update handler validates with partial schema + id", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("user", userEntity);
      r.crud("user");
    });

    const updateHandler = feature.writeHandlers["user.update"];
    // Partial update with id
    expect(updateHandler?.schema.safeParse({ id: 1, changes: { firstName: "Marc" } }).success).toBe(
      true,
    );
    // Id is required
    expect(updateHandler?.schema.safeParse({ changes: { firstName: "Marc" } }).success).toBe(false);
    // Still validates types in changes
    expect(updateHandler?.schema.safeParse({ id: 1, changes: { isEnabled: "nope" } }).success).toBe(
      false,
    );
  });

  test("delete handler requires id", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("user", userEntity);
      r.crud("user");
    });

    const deleteHandler = feature.writeHandlers["user.delete"];
    expect(deleteHandler?.schema.safeParse({ id: 1 }).success).toBe(true);
    expect(deleteHandler?.schema.safeParse({}).success).toBe(false);
  });

  test("list handler has pagination and search params", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("user", userEntity);
      r.crud("user");
    });

    const listHandler = feature.queryHandlers["user.list"];
    // All optional
    expect(listHandler?.schema.safeParse({}).success).toBe(true);
    // With params
    expect(
      listHandler?.schema.safeParse({ cursor: "abc", limit: 25, search: "marc" }).success,
    ).toBe(true);
  });

  test("detail handler requires id", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("user", userEntity);
      r.crud("user");
    });

    const detailHandler = feature.queryHandlers["user.detail"];
    expect(detailHandler?.schema.safeParse({ id: 1 }).success).toBe(true);
    expect(detailHandler?.schema.safeParse({}).success).toBe(false);
  });

  test("passes access rules to all handlers", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("post", createEntity({ table: "Posts", fields: {} }));
      r.crud("post", { access: { roles: ["Admin"] } });
    });

    expect(feature.writeHandlers["post.create"]?.access?.roles).toEqual(["Admin"]);
    expect(feature.writeHandlers["post.update"]?.access?.roles).toEqual(["Admin"]);
    expect(feature.writeHandlers["post.delete"]?.access?.roles).toEqual(["Admin"]);
    expect(feature.queryHandlers["post.list"]?.access?.roles).toEqual(["Admin"]);
    expect(feature.queryHandlers["post.detail"]?.access?.roles).toEqual(["Admin"]);
  });

  test("throws if entity not registered before crud", () => {
    expect(() => {
      defineFeature("test", (r) => {
        r.crud("nonexistent");
      });
    }).toThrow(/entity.*nonexistent.*not found/i);
  });
});
