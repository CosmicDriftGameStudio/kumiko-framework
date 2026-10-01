import { describe, expect, test } from "bun:test";
import {
  booleanFacetOptionKeys,
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
