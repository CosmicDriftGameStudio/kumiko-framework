import { describe, expect, test } from "bun:test";
import { defineFeature } from "../define-feature";
import { createEntity, createTextField } from "../factories";

const taskEntity = createEntity({
  table: "crud_shorthand_tasks",
  fields: { title: createTextField({ required: true }) },
  softDelete: true,
});

describe("r.crud", () => {
  test("registers the entity + full CRUD handler set, same as registerEntityCrud", () => {
    const write = { access: { roles: ["Admin"] } } as const;
    const read = { access: { openToAll: true } } as const;

    const feature = defineFeature("via-crud", (r) => {
      r.crud("task", taskEntity, { write, read });
    });

    expect(Object.keys(feature.entities ?? {})).toEqual(["task"]);
    expect(Object.keys(feature.writeHandlers ?? {}).sort()).toEqual(
      ["task:create", "task:delete", "task:restore", "task:update"].sort(),
    );
    expect(Object.keys(feature.queryHandlers ?? {}).sort()).toEqual(
      ["task:detail", "task:list"].sort(),
    );
  });
});
