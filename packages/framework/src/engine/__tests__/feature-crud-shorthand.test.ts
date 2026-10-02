import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { defineFeature } from "../define-feature.js";
import { createEntity, createTextField } from "../factories.js";

const taskEntity = createEntity({
  table: "crud_shorthand_tasks",
  fields: { title: createTextField({ required: true, personal: false, reason: "test_fixture" }) },
  softDelete: true,
});

describe("r.crud", () => {
  test("registers the entity + full CRUD handler set, same as registerEntityCrud", () => {
    const write = { access: { roles: ["Admin"] } } as const;
    const read = {
      access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
    } as const;

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
    const read = {
      access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
    } as const;

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
    const read = {
      access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
    } as const;
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

describe("duplicate handler names inside one feature", () => {
  const access = { openToAll: { reason: "test handler callable by any signed-in test user" } };
  const crudAccess = { write: { access: { roles: ["Admin"] } }, read: { access } } as const;

  test("a custom query named like an r.crud handler throws and names the cause", () => {
    expect(() =>
      defineFeature("dup-crud", (r) => {
        r.crud("task", taskEntity, crudAccess);
        r.queryHandler("task:detail", z.object({}), async () => null, { access });
      }),
    ).toThrow(
      /Feature "dup-crud" registers the query handler "task:detail" twice\. r\.crud\("task", \.\.\.\) already registers that name; use a distinct name or drop the "detail" verb from r\.crud\./,
    );
  });

  test("the order does not matter: r.crud after the custom handler throws too", () => {
    expect(() =>
      defineFeature("dup-crud-after", (r) => {
        r.entity("task", taskEntity);
        r.writeHandler("task:create", z.object({}), async () => ({ isSuccess: true, data: {} }), {
          access: { roles: ["Admin"] },
        });
        r.crud("task", taskEntity, crudAccess);
      }),
    ).toThrow(/registers the write handler "task:create" twice/);
  });

  test("a plain duplicate custom name throws", () => {
    expect(() =>
      defineFeature("dup-plain", (r) => {
        r.queryHandler("lookup", z.object({}), async () => null, { access });
        r.queryHandler("lookup", z.object({}), async () => null, { access });
      }),
    ).toThrow(
      /Feature "dup-plain" registers the query handler "lookup" twice\. Use a distinct name\./,
    );
  });
});
