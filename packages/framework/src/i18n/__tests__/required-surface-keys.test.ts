import { describe, expect, test } from "bun:test";
import type { FeatureDefinition } from "../../engine/types";
import {
  booleanFacetOptionKeys,
  requiredKeysFromFeature,
  requiredKeysFromScreen,
  selectFacetOptionKey,
} from "../required-surface-keys.js";

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

describe("requiredKeysFromScreen — entityList expandableRow groupBy", () => {
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
        groupBy: {
          field: "status",
          collapsedWhen: "done",
          labels: { done: "campaigns:posts:group-done" },
        },
      },
    });
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
