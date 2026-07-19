import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { validateBoot } from "../boot-validator";
import { defineFeature } from "../define-feature";
import { createEntity, createTextField } from "../factories";

describe("validateBoot — action wiring (no function values)", () => {
  test("rowAction writeHandler payload as function → Throw", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity("product", createEntity({ fields: { name: createTextField() } }));
      r.screen({
        id: "product-list",
        type: "entityList",
        entity: "product",
        columns: ["name"],
        rowActions: [
          {
            kind: "writeHandler",
            id: "sync",
            label: "actions.sync",
            handler: "shop:write:sync",
            // biome-ignore lint/suspicious/noExplicitAny: intentional type violation under test
            payload: ((row: unknown) => ({ id: row })) as any,
          },
        ],
      });
      r.writeHandler("sync", z.object({}), async () => ({ isSuccess: true as const, data: null }), {
        access: { roles: ["Admin"] },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/rowAction "sync" payload is a function/);
  });

  test("rowAction writeHandler payload as declarative pick → kein Throw", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity("product", createEntity({ fields: { name: createTextField({ sortable: true }) } }));
      r.screen({
        id: "product-list",
        type: "entityList",
        entity: "product",
        columns: ["name"],
        defaultSort: { field: "name", dir: "asc" },
        rowActions: [
          {
            kind: "writeHandler",
            id: "sync",
            label: "actions.sync",
            handler: "shop:write:sync",
            payload: { pick: ["name"] },
          },
        ],
      });
      r.writeHandler("sync", z.object({}), async () => ({ isSuccess: true as const, data: null }), {
        access: { roles: ["Admin"] },
      });
      r.translations({
        keys: {
          "screen:product-list.title": { de: "Liste", en: "List" },
          "shop:entity:product:field:name": { de: "Name", en: "Name" },
        },
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("rowAction navigate visible as function → Throw", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity("product", createEntity({ fields: { name: createTextField() } }));
      r.screen({
        id: "product-list",
        type: "entityList",
        entity: "product",
        columns: ["name"],
        rowActions: [
          {
            kind: "navigate",
            id: "edit",
            label: "actions.edit",
            screen: "product-list",
            // biome-ignore lint/suspicious/noExplicitAny: intentional type violation under test
            visible: (() => true) as any,
          },
        ],
      });
    });
    expect(() => validateBoot([feature])).toThrow(/rowAction "edit" visible is a function/);
  });

  test("toolbarAction writeHandler payload as function → Throw", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity("product", createEntity({ fields: { name: createTextField() } }));
      r.screen({
        id: "product-list",
        type: "entityList",
        entity: "product",
        columns: ["name"],
        toolbarActions: [
          {
            kind: "writeHandler",
            id: "sync",
            label: "actions.sync",
            handler: "shop:write:sync",
            // biome-ignore lint/suspicious/noExplicitAny: intentional type violation under test
            payload: (() => ({})) as any,
          },
        ],
      });
      r.writeHandler("sync", z.object({}), async () => ({ isSuccess: true as const, data: null }), {
        access: { roles: ["Admin"] },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/toolbarAction "sync" payload is a function/);
  });

  test("entityList column renderer as function → Throw", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity("product", createEntity({ fields: { name: createTextField() } }));
      r.screen({
        id: "product-list",
        type: "entityList",
        entity: "product",
        columns: [
          // biome-ignore lint/suspicious/noExplicitAny: intentional type violation under test
          { field: "name", renderer: ((v: unknown) => String(v)) as any },
        ],
      });
    });
    expect(() => validateBoot([feature])).toThrow(/column "name" renderer is a function/);
  });

  test("entityEdit field visible as function → Throw", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity("product", createEntity({ fields: { name: createTextField() } }));
      r.screen({
        id: "product-edit",
        type: "entityEdit",
        entity: "product",
        layout: {
          sections: [
            {
              columns: 1,
              // biome-ignore lint/suspicious/noExplicitAny: intentional type violation under test
              fields: [{ field: "name", visible: (() => true) as any }],
            },
          ],
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/field "name" visible is a function/);
  });

  test("entityEdit field renderer as function → Throw", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity("product", createEntity({ fields: { name: createTextField() } }));
      r.screen({
        id: "product-edit",
        type: "entityEdit",
        entity: "product",
        layout: {
          sections: [
            {
              columns: 1,
              // biome-ignore lint/suspicious/noExplicitAny: intentional type violation under test
              fields: [{ field: "name", renderer: ((v: unknown) => String(v)) as any }],
            },
          ],
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/field "name" renderer is a function/);
  });

  test("entityEdit field with declarative visible/readOnly/required → kein Throw", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity("product", createEntity({ fields: { name: createTextField() } }));
      r.screen({
        id: "product-edit",
        type: "entityEdit",
        entity: "product",
        layout: {
          sections: [
            {
              columns: 1,
              fields: [
                {
                  field: "name",
                  visible: { field: "name", ne: "" },
                  readOnly: false,
                  required: true,
                },
              ],
            },
          ],
        },
      });
      r.translations({
        keys: {
          "screen:product-edit.title": { de: "Bearbeiten", en: "Edit" },
          "shop:entity:product:field:name": { de: "Name", en: "Name" },
        },
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("projectionList column renderer as function → Throw", () => {
    const feature = defineFeature("shop", (r) => {
      r.screen({
        id: "sales-list",
        type: "projectionList",
        query: "shop:query:sales",
        columns: [
          // biome-ignore lint/suspicious/noExplicitAny: intentional type violation under test
          { field: "amount", renderer: ((v: unknown) => String(v)) as any },
        ],
      });
    });
    expect(() => validateBoot([feature])).toThrow(/column "amount" renderer is a function/);
  });

  test("projectionList rowAction payload as function → Throw", () => {
    const feature = defineFeature("shop", (r) => {
      r.screen({
        id: "sales-list",
        type: "projectionList",
        query: "shop:query:sales",
        columns: ["amount"],
        rowActions: [
          {
            kind: "writeHandler",
            id: "sync",
            label: "actions.sync",
            handler: "shop:write:sync",
            // biome-ignore lint/suspicious/noExplicitAny: intentional type violation under test
            payload: (() => ({})) as any,
          },
        ],
      });
    });
    expect(() => validateBoot([feature])).toThrow(/rowAction "sync" payload is a function/);
  });
});
