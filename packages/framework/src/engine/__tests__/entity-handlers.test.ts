import { describe, expect, test } from "vitest";
import { defineEntityQueryHandler, defineEntityWriteHandler } from "../entity-handlers";
import { createEntity, createTextField } from "../factories";

const VALID_UUID = "00000000-0000-4000-8000-000000000001";

const noteEntity = createEntity({
  table: "notes",
  idType: "uuid",
  fields: {
    title: createTextField({ required: true }),
    body: createTextField(),
  },
});

const noteEntitySoftDelete = createEntity({
  table: "notes_soft",
  idType: "uuid",
  fields: {
    title: createTextField({ required: true }),
  },
  softDelete: true,
});

describe("defineEntityWriteHandler", () => {
  test("throws when name has no colon", () => {
    expect(() => defineEntityWriteHandler("note", noteEntity)).toThrow(/<entity>:<verb>/);
  });

  test("throws when entity part is empty", () => {
    expect(() => defineEntityWriteHandler(":create", noteEntity)).toThrow(
      /missing the entity part/,
    );
  });

  test("throws when verb is unknown", () => {
    expect(() => defineEntityWriteHandler("note:archive", noteEntity)).toThrow(
      /Unknown verb "archive"/,
    );
  });

  test("throws when restore is requested on an entity without softDelete", () => {
    expect(() => defineEntityWriteHandler("note:restore", noteEntity)).toThrow(
      /restore is only valid/,
    );
  });

  test("create: handler def carries name, schema, handler", () => {
    const def = defineEntityWriteHandler("note:create", noteEntity);
    expect(def.name).toBe("note:create");
    expect(typeof def.handler).toBe("function");
    expect(def.schema.safeParse({ title: "x" }).success).toBe(true);
    expect(def.schema.safeParse({}).success).toBe(false);
  });

  test("update: schema requires id + version + changes", () => {
    const def = defineEntityWriteHandler("note:update", noteEntity);
    expect(
      def.schema.safeParse({ id: VALID_UUID, version: 1, changes: { title: "x" } }).success,
    ).toBe(true);
    expect(def.schema.safeParse({ id: VALID_UUID, changes: { title: "x" } }).success).toBe(false);
    expect(def.schema.safeParse({ id: VALID_UUID, version: 1 }).success).toBe(false);
  });

  test("delete: schema requires only id", () => {
    const def = defineEntityWriteHandler("note:delete", noteEntity);
    expect(def.schema.safeParse({ id: VALID_UUID }).success).toBe(true);
    expect(def.schema.safeParse({}).success).toBe(false);
  });

  test("restore: schema requires only id (with softDelete)", () => {
    const def = defineEntityWriteHandler("note:restore", noteEntitySoftDelete);
    expect(def.schema.safeParse({ id: VALID_UUID }).success).toBe(true);
    expect(def.schema.safeParse({}).success).toBe(false);
  });

  test("access option is forwarded into the handler def", () => {
    const def = defineEntityWriteHandler("note:create", noteEntity, {
      access: { roles: ["Admin"] },
    });
    expect(def.access).toEqual({ roles: ["Admin"] });
  });

  test("omitting access leaves the handler def's access unset", () => {
    const def = defineEntityWriteHandler("note:create", noteEntity);
    expect(def.access).toBeUndefined();
  });
});

describe("defineEntityQueryHandler", () => {
  test("throws when verb is unknown (write verbs are not allowed here)", () => {
    expect(() => defineEntityQueryHandler("note:create", noteEntity)).toThrow(
      /Unknown verb "create"/,
    );
  });

  test("list: schema accepts the standard pagination/search/sort params", () => {
    const def = defineEntityQueryHandler("note:list", noteEntity);
    expect(def.schema.safeParse({}).success).toBe(true);
    expect(
      def.schema.safeParse({
        cursor: "abc",
        limit: 10,
        search: "y",
        sort: "title",
        sortDirection: "asc",
      }).success,
    ).toBe(true);
    expect(def.schema.safeParse({ sortDirection: "wrong" }).success).toBe(false);
  });

  test("detail: schema requires id", () => {
    const def = defineEntityQueryHandler("note:detail", noteEntity);
    expect(def.schema.safeParse({ id: VALID_UUID }).success).toBe(true);
    expect(def.schema.safeParse({}).success).toBe(false);
  });

  test("access option is forwarded", () => {
    const def = defineEntityQueryHandler("note:list", noteEntity, {
      access: { openToAll: true },
    });
    expect(def.access).toEqual({ openToAll: true });
  });
});
