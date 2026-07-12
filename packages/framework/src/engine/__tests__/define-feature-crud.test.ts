import { describe, expect, test } from "bun:test";
import { defineFeature } from "../define-feature";
import { registerEntityCrud } from "../entity-handlers";
import { createEntity, createTextField } from "../factories";

const taskEntity = createEntity({
  table: "crud_sugar_tasks",
  fields: {
    title: createTextField({ required: true }),
  },
  softDelete: true,
});

const access = {
  write: { access: { roles: ["Admin"] } },
  read: { access: { openToAll: true } },
} as const;

describe("r.crud", () => {
  test("registers the same entity + handlers as registerEntityCrud", () => {
    const viaCrud = defineFeature("crud-sugar", (r) => {
      r.crud("task", taskEntity, access);
    });
    const viaHelper = defineFeature("crud-sugar", (r) => {
      registerEntityCrud(r, "task", taskEntity, access);
    });

    expect(viaCrud.entities).toEqual(viaHelper.entities);
    expect(Object.keys(viaCrud.writeHandlers)).toEqual(Object.keys(viaHelper.writeHandlers));
    expect(Object.keys(viaCrud.queryHandlers)).toEqual(Object.keys(viaHelper.queryHandlers));
    expect(Object.keys(viaCrud.writeHandlers)).toEqual([
      "task:create",
      "task:update",
      "task:delete",
      "task:restore",
    ]);
    expect(Object.keys(viaCrud.queryHandlers)).toEqual(["task:list", "task:detail"]);
    expect(viaCrud.writeHandlers["task:create"]?.access).toEqual({ roles: ["Admin"] });
    expect(viaCrud.queryHandlers["task:list"]?.access).toEqual({ openToAll: true });
  });

  test("returns an EntityRef like r.entity", () => {
    defineFeature("crud-sugar", (r) => {
      const ref = r.crud("task", taskEntity, access);
      expect(ref).toEqual({ name: "task", table: "crud_sugar_tasks" });
    });
  });

  test("verbs opt-out skips handlers", () => {
    const feature = defineFeature("crud-sugar", (r) => {
      r.crud("task", taskEntity, { ...access, verbs: { delete: false, restore: false } });
    });
    expect(Object.keys(feature.writeHandlers)).toEqual(["task:create", "task:update"]);
  });
});
