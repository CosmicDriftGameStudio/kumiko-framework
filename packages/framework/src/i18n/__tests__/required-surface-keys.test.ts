import { describe, expect, test } from "bun:test";
import type { FeatureDefinition } from "../../engine/types";
import {
  booleanFacetOptionKeys,
  requiredKeysFromFeature,
  requiredKeysFromScreen,
  selectFacetOptionKey,
} from "../required-surface-keys.ts";

describe("required-surface-keys helpers", () => {
  test("booleanFacetOptionKeys emits true/false option keys", () => {
    expect(booleanFacetOptionKeys("tenant", "tenant", "isEnabled")).toEqual([
      "tenant:entity:tenant:field:isEnabled:option:true",
      "tenant:entity:tenant:field:isEnabled:option:false",
    ]);
  });

  test("selectFacetOptionKey encodes option value", () => {
    expect(selectFacetOptionKey("user", "user", "status", "active")).toBe(
      "user:entity:user:field:status:option:active",
    );
  });
});

describe("requiredKeysFromScreen — entityList expandableRow", () => {
  test("includes the sub-list's title, column labels and row-action labels", () => {
    const keys = requiredKeysFromScreen("campaigns", {
      id: "campaign-list",
      type: "entityList",
      entity: "campaign",
      columns: ["name"],
      expandableRow: {
        kind: "relatedList",
        title: "campaigns:posts:title",
        query: "campaigns:query:post:list",
        parentParam: "campaign",
        columns: [{ field: "datum", label: "campaigns:posts:date" }],
        emptyState: { title: "campaigns:posts:empty", description: "campaigns:posts:empty-hint" },
        rowActions: [
          {
            kind: "writeHandler",
            id: "mark-posted",
            label: "campaigns:posts:mark-posted",
            handler: "campaigns:write:mark-posted",
          },
        ],
      },
    });
    expect(keys).toContain("campaigns:posts:title");
    expect(keys).toContain("campaigns:posts:date");
    expect(keys).toContain("campaigns:posts:mark-posted");
    expect(keys).toContain("campaigns:posts:empty");
    expect(keys).toContain("campaigns:posts:empty-hint");
  });
});

describe("requiredKeysFromScreen — entityList expandableRow table.grouping", () => {
  test("requires the group header keys of an expandable sub-list", () => {
    const keys = requiredKeysFromScreen("campaigns", {
      id: "campaign-list",
      type: "entityList",
      entity: "campaign",
      columns: ["name"],
      expandableRow: {
        kind: "relatedList",
        title: "campaigns:posts:title",
        query: "campaigns:query:post:list",
        parentParam: "campaign",
        columns: ["datum"],
        table: {
          grouping: {
            field: "status",
            collapsedWhen: "done",
            label: "campaigns:posts:group",
            labels: { done: "campaigns:posts:group-done" },
          },
        },
      },
    });
    expect(keys).toContain("campaigns:posts:group");
    expect(keys).toContain("campaigns:posts:group-done");
  });
});

describe("requiredKeysFromScreen — projectionDetail writeForm section", () => {
  test("includes the section description alongside title and submit label", () => {
    const keys = requiredKeysFromScreen("billing", {
      id: "invoice-detail",
      type: "projectionDetail",
      layout: {
        sections: [
          {
            kind: "writeForm",
            title: "billing:form:title",
            description: "billing:form:description",
            submitLabel: "billing:form:submit",
            handler: "billing:write:invoice:update",
            fieldDefs: {},
            fields: [],
          },
        ],
      },
    } as unknown as Parameters<typeof requiredKeysFromScreen>[1]);
    expect(keys).toContain("billing:form:title");
    expect(keys).toContain("billing:form:description");
    expect(keys).toContain("billing:form:submit");
  });
});

describe("requiredKeysFromFeature — filterable multiSelect facets", () => {
  test("requires one option key per multiSelect option", () => {
    const feature = {
      name: "crm",
      screens: { list: { type: "entityList", entity: "contact", columns: [] } },
      navs: {},
      workspaces: {},
      configKeys: {},
      entities: {
        contact: {
          fields: { tags: { type: "multiSelect", filterable: true, options: ["a", "b"] } },
        },
      },
    } as unknown as FeatureDefinition;
    const keys = requiredKeysFromFeature(feature);
    expect(keys).toContain(selectFacetOptionKey("crm", "contact", "tags", "a"));
    expect(keys).toContain(selectFacetOptionKey("crm", "contact", "tags", "b"));
  });
});

describe("requiredKeysFromScreen — list emptyState and description", () => {
  const emptyState = {
    title: "shop:orders:empty",
    description: "shop:orders:empty-hint",
    action: {
      kind: "writeHandler" as const,
      id: "sync",
      label: "shop:orders:sync",
      handler: "shop:write:sync",
    },
  };

  test("entityList requires emptyState title, description, action label and screen description", () => {
    const keys = requiredKeysFromScreen("shop", {
      id: "order-list",
      type: "entityList",
      entity: "order",
      columns: ["name"],
      description: "shop:orders:description",
      emptyState,
    });
    expect(keys).toEqual(
      expect.arrayContaining([
        "shop:orders:empty",
        "shop:orders:empty-hint",
        "shop:orders:sync",
        "shop:orders:description",
      ]),
    );
  });

  test("projectionList requires the same keys", () => {
    const keys = requiredKeysFromScreen("shop", {
      id: "order-overview",
      type: "projectionList",
      query: "shop:query:order:list",
      columns: [{ field: "name", label: "shop:orders:name" }],
      description: "shop:orders:description",
      emptyState,
    });
    expect(keys).toEqual(
      expect.arrayContaining([
        "shop:orders:empty",
        "shop:orders:empty-hint",
        "shop:orders:sync",
        "shop:orders:description",
      ]),
    );
  });
});

describe("requiredKeysFromScreen — field texts and success links", () => {
  const fieldSpec = {
    field: "slug",
    placeholder: "shop:slug:hint",
    prefix: "shop:slug:prefix",
    suffix: { field: "domain" },
    fillAction: { label: "shop:slug:suggest", query: "shop:query:slug:suggest", field: "slug" },
  };
  const literalSpec = {
    field: "slug",
    placeholder: "Type a slug",
    prefix: "/shop/",
    suffix: ".example.com",
    fillAction: { label: "Suggest", query: "shop:query:slug:suggest", field: "slug" },
  };

  test("actionForm requires success link and item link labels and the field placeholder, affix and fill labels", () => {
    const keys = requiredKeysFromScreen("shop", {
      id: "create-shop",
      type: "actionForm",
      handler: "shop:write:create",
      fields: { slug: { type: "text" }, domain: { type: "text" } },
      layout: { sections: [{ fields: [fieldSpec, "domain"] }] },
      successLinks: [
        { screen: "shop-list", label: "shop:link:list" },
        { screen: "shop-edit", idFrom: "id", label: "Open shop" },
      ],
      successItems: { field: "results", link: { screen: "shop-list", label: "shop:link:open" } },
    } as unknown as Parameters<typeof requiredKeysFromScreen>[1]);
    expect(keys).toEqual(
      expect.arrayContaining([
        "shop:link:list",
        "shop:link:open",
        "shop:slug:hint",
        "shop:slug:prefix",
        "shop:slug:suggest",
      ]),
    );
    expect(keys).not.toContain("domain");
    expect(keys).not.toContain("Open shop");
  });

  test("entityEdit requires the same field texts", () => {
    const keys = requiredKeysFromScreen("shop", {
      id: "shop-edit",
      type: "entityEdit",
      entity: "shop",
      layout: { sections: [{ fields: [fieldSpec] }] },
    } as unknown as Parameters<typeof requiredKeysFromScreen>[1]);
    expect(keys).toEqual(
      expect.arrayContaining(["shop:slug:hint", "shop:slug:prefix", "shop:slug:suggest"]),
    );
  });

  test("configEdit and secretMint steps require the field texts", () => {
    const configKeys = requiredKeysFromScreen(
      "shop",
      {
        id: "shop-config",
        type: "configEdit",
        fields: { slug: { type: "text" } },
        layout: { sections: [{ fields: [fieldSpec] }] },
      } as unknown as Parameters<typeof requiredKeysFromScreen>[1],
      { treatDotFormAsKey: true },
    );
    expect(configKeys).toContain("shop:slug:hint");
    const mintKeys = requiredKeysFromScreen("shop", {
      id: "shop-mint",
      type: "secretMint",
      fields: { slug: { type: "text" } },
      layout: { sections: [{ fields: [fieldSpec] }] },
      reveal: { fields: [] },
    } as unknown as Parameters<typeof requiredKeysFromScreen>[1]);
    expect(mintKeys).toContain("shop:slug:suggest");
  });

  test("literal placeholder, affix and fill label are no keys", () => {
    const keys = requiredKeysFromScreen("shop", {
      id: "create-shop",
      type: "actionForm",
      handler: "shop:write:create",
      fields: { slug: { type: "text" } },
      layout: { sections: [{ fields: [literalSpec] }] },
    } as unknown as Parameters<typeof requiredKeysFromScreen>[1]);
    for (const literal of ["Type a slug", "/shop/", ".example.com", "Suggest"]) {
      expect(keys).not.toContain(literal);
    }
  });

  test("a screen with an unknown type yields only its title key", () => {
    expect(requiredKeysFromScreen("shop", { id: "mystery", type: "bogus" } as never)).toEqual([
      "screen:mystery.title",
    ]);
  });
});
