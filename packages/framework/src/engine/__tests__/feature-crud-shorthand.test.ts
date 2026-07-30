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

  test("without verbAccess, write handlers keep write.access (never fall back to the broader read.access)", () => {
    const write = { access: { roles: ["Manager"] } } as const;
    const read = { access: { openToAll: true } } as const;

    const feature = defineFeature("via-crud-no-verb-access", (r) => {
      r.crud("task", taskEntity, { write, read });
    });

    for (const verb of ["create", "update", "delete", "restore"] as const) {
      expect(feature.writeHandlers?.[`task:${verb}`]?.access).toEqual(write.access);
    }
    for (const verb of ["list", "detail"] as const) {
      expect(feature.queryHandlers?.[`task:${verb}`]?.access).toEqual(read.access);
    }
  });

  test("verbAccess overrides access per verb, other verbs keep write/read.access", () => {
    const write = { access: { roles: ["Manager"] } } as const;
    const read = { access: { openToAll: true } } as const;
    const deleteAccess = { roles: ["Operator"] } as const;
    const restoreAccess = { roles: ["Operator"] } as const;
    const listAccess = { roles: ["Auditor"] } as const;

    const feature = defineFeature("via-crud-verb-access", (r) => {
      r.crud("task", taskEntity, {
        write,
        read,
        verbAccess: { delete: deleteAccess, restore: restoreAccess, list: listAccess },
      });
    });

    expect(feature.writeHandlers?.["task:create"]?.access).toEqual(write.access);
    expect(feature.writeHandlers?.["task:update"]?.access).toEqual(write.access);
    expect(feature.writeHandlers?.["task:delete"]?.access).toEqual(deleteAccess);
    expect(feature.writeHandlers?.["task:restore"]?.access).toEqual(restoreAccess);
    expect(feature.queryHandlers?.["task:list"]?.access).toEqual(listAccess);
    expect(feature.queryHandlers?.["task:detail"]?.access).toEqual(read.access);
  });
});
