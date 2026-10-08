import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { validateBoot } from "../boot-validator.js";
import { defineFeature } from "../define-feature.js";
import { createEntity, createTextField } from "../factories.js";

describe("validateBoot — action wiring (no function values)", () => {
  test("rowAction writeHandler payload as function → Throw", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity(
        "product",
        createEntity({
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
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
      r.entity(
        "product",
        createEntity({
          fields: {
            name: createTextField({ sortable: true, personal: false, reason: "test_fixture" }),
          },
        }),
      );
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
      r.entity(
        "product",
        createEntity({
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
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
      r.entity(
        "product",
        createEntity({
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
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

  test("projectionDetail action payload as function → Throw (fw#2166)", () => {
    const feature = defineFeature("shop", (r) => {
      r.screen({
        id: "order-detail",
        type: "projectionDetail",
        query: "shop:query:order:detail",
        layout: { sections: [{ title: "s", fields: ["total"] }] },
        actions: [
          {
            kind: "writeHandler",
            id: "archive",
            label: "actions.archive",
            handler: "shop:write:archive",
            // biome-ignore lint/suspicious/noExplicitAny: intentional type violation under test
            payload: ((row: unknown) => ({ id: row })) as any,
          },
        ],
      });
    });
    expect(() => validateBoot([feature])).toThrow(/action "archive" payload is a function/);
  });

  test("projectionDetail writeHandler action redirect to an unknown screen → Throw", () => {
    const feature = defineFeature("shop", (r) => {
      r.screen({
        id: "order-detail",
        type: "projectionDetail",
        query: "shop:query:order:detail",
        layout: { sections: [{ title: "s", fields: ["total"] }] },
        actions: [
          {
            kind: "writeHandler",
            id: "archive",
            label: "actions.archive",
            handler: "shop:write:archive",
            redirect: "ghost-screen",
          },
        ],
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /redirect "ghost-screen" does not resolve to a registered screen/,
    );
  });

  test("projectionDetail writeHandler action redirect to a registered screen does not trip the redirect check", () => {
    const feature = defineFeature("shop", (r) => {
      r.screen({
        id: "order-overview",
        type: "custom",
        renderer: { react: "stub" },
      });
      r.screen({
        id: "order-detail",
        type: "projectionDetail",
        query: "shop:query:order:detail",
        layout: { sections: [{ title: "s", fields: ["total"] }] },
        actions: [
          {
            kind: "writeHandler",
            id: "archive",
            label: "actions.archive",
            handler: "shop:write:archive",
            redirect: "order-overview",
          },
        ],
      });
    });
    let message = "";
    try {
      validateBoot([feature]);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).not.toMatch(/redirect/);
  });

  describe("record action redirect wiring across all four call sites", () => {
    type Redirect = string | { screen: string; idFrom: string };
    type Site =
      | "projectionDetail header"
      | "projectionDetail section"
      | "entityEdit header"
      | "entityEdit section";
    const sites: readonly Site[] = [
      "projectionDetail header",
      "projectionDetail section",
      "entityEdit header",
      "entityEdit section",
    ];

    function featureWithRedirect(site: Site, redirect: Redirect) {
      const action = {
        kind: "writeHandler" as const,
        id: "archive",
        label: "actions.archive",
        handler: "shop:write:archive",
        redirect,
      };
      return defineFeature("shop", (r) => {
        r.entity(
          "product",
          createEntity({
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        );
        r.screen({ id: "overview", type: "custom", renderer: { react: "stub" } });
        r.screen({
          id: "order-detail-target",
          type: "projectionDetail",
          query: "shop:query:order:detail",
          layout: { sections: [{ title: "s", fields: ["total"] }] },
        });
        if (site.startsWith("projectionDetail")) {
          r.screen({
            id: "order-detail",
            type: "projectionDetail",
            query: "shop:query:order:detail",
            layout: {
              sections: [
                {
                  title: "s",
                  fields: ["total"],
                  ...(site.endsWith("section") ? { actions: [action] } : {}),
                },
              ],
            },
            ...(site.endsWith("header") ? { actions: [action] } : {}),
          });
        } else {
          r.screen({
            id: "product-edit",
            type: "entityEdit",
            entity: "product",
            layout: {
              sections: [
                {
                  columns: 1,
                  fields: ["name"],
                  ...(site.endsWith("section") ? { actions: [action] } : {}),
                },
              ],
            },
            ...(site.endsWith("header") ? { actions: [action] } : {}),
          });
        }
      });
    }

    for (const site of sites) {
      test(`${site}: string redirect to an unknown screen → Throw`, () => {
        expect(() => validateBoot([featureWithRedirect(site, "ghost-screen")])).toThrow(
          /redirect "ghost-screen" does not resolve to a registered screen/,
        );
      });

      test(`${site}: object-form redirect to an unknown screen → Throw`, () => {
        expect(() =>
          validateBoot([featureWithRedirect(site, { screen: "ghost-screen", idFrom: "id" })]),
        ).toThrow(/redirect "ghost-screen" does not resolve to a registered screen/);
      });

      test(`${site}: object-form redirect with empty idFrom → Throw`, () => {
        expect(() =>
          validateBoot([featureWithRedirect(site, { screen: "overview", idFrom: " " })]),
        ).toThrow(/redirect\.idFrom is empty or not a string/);
      });

      test(`${site}: object-form redirect with idFrom to a screen that carries no id → Throw`, () => {
        expect(() =>
          validateBoot([featureWithRedirect(site, { screen: "overview", idFrom: "id" })]),
        ).toThrow(/redirect\.idFrom is set but target screen "overview" \(custom\) carries no id/);
      });

      test(`${site}: object-form redirect to a registered screen does not trip the redirect check`, () => {
        let message = "";
        try {
          validateBoot([
            featureWithRedirect(site, { screen: "order-detail-target", idFrom: "id" }),
          ]);
        } catch (e) {
          message = e instanceof Error ? e.message : String(e);
        }
        expect(message).not.toMatch(/redirect/);
      });
    }
  });

  test("entityList rowAction writeHandler with redirect → Throw (ignored on list rows)", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity(
        "product",
        createEntity({
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
      r.screen({ id: "overview", type: "custom", renderer: { react: "stub" } });
      r.screen({
        id: "product-list",
        type: "entityList",
        entity: "product",
        columns: ["name"],
        rowActions: [
          {
            kind: "writeHandler",
            id: "archive",
            label: "actions.archive",
            handler: "shop:write:archive",
            redirect: "overview",
          },
        ],
      });
      r.writeHandler(
        "archive",
        z.object({}),
        async () => ({ isSuccess: true as const, data: null }),
        {
          access: { roles: ["Admin"] },
        },
      );
    });
    expect(() => validateBoot([feature])).toThrow(/rowAction "archive" sets redirect/);
  });

  test("projectionList rowAction writeHandler with redirect → Throw (ignored on list rows)", () => {
    const feature = defineFeature("shop", (r) => {
      r.screen({ id: "overview", type: "custom", renderer: { react: "stub" } });
      r.screen({
        id: "order-list",
        type: "projectionList",
        query: "shop:query:order:list",
        columns: ["total"],
        rowActions: [
          {
            kind: "writeHandler",
            id: "archive",
            label: "actions.archive",
            handler: "shop:write:archive",
            redirect: "overview",
          },
        ],
      });
    });
    expect(() => validateBoot([feature])).toThrow(/rowAction "archive" sets redirect/);
  });

  test("entityList column renderer as function → Throw", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity(
        "product",
        createEntity({
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
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
      r.entity(
        "product",
        createEntity({
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
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
      r.entity(
        "product",
        createEntity({
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
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

  test("entityEdit field renderer as function inside groups → Throw", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity(
        "product",
        createEntity({
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
      r.screen({
        id: "product-edit",
        type: "entityEdit",
        entity: "product",
        layout: {
          sections: [
            {
              columns: 1,
              fields: [],
              groups: [
                {
                  title: "Basis",
                  // biome-ignore lint/suspicious/noExplicitAny: intentional type violation under test
                  fields: [{ field: "name", renderer: ((v: unknown) => String(v)) as any }],
                },
              ],
            },
          ],
        },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/field "name" renderer is a function/);
  });

  test("entityEdit field with declarative visible/readOnly/required → kein Throw", () => {
    const feature = defineFeature("shop", (r) => {
      r.entity(
        "product",
        createEntity({
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
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

  test("projectionDetail relatedList column renderer as function → Throw (fw#2166)", () => {
    const feature = defineFeature("shop", (r) => {
      r.screen({
        id: "order-detail",
        type: "projectionDetail",
        query: "shop:query:order:detail",
        layout: {
          sections: [
            {
              kind: "relatedList",
              title: "Payments",
              query: "shop:query:order:payments",
              columns: [
                // biome-ignore lint/suspicious/noExplicitAny: intentional type violation under test
                { field: "amount", renderer: ((v: unknown) => String(v)) as any },
              ],
            },
          ],
        },
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
