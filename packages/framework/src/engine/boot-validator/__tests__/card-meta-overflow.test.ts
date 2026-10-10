import { describe, expect, test } from "bun:test";
import { defineFeature } from "../../define-feature.js";
import { createEntity, createSelectField, createTextField } from "../../factories.js";
import type { EditRelatedListSection, ListColumnSpec } from "../../types/index.js";
import { collectCardMetaOverflow, validateCardMetaOverflow } from "../card-meta-overflow.js";

const text = () => createTextField({ personal: false, reason: "test_fixture" });
const entity = createEntity({
  fields: {
    name: text(),
    a: text(),
    b: text(),
    c: text(),
    d: text(),
    state: createSelectField({ options: ["open", "done"], required: true }),
  },
});

function listFeature(columns: readonly ListColumnSpec[]) {
  return defineFeature("cards", (r) => {
    r.entity("item", entity);
    r.screen({ id: "item-list", type: "entityList", entity: "item", columns });
  });
}

function relatedSection(columns: readonly ListColumnSpec[]): EditRelatedListSection {
  return {
    id: "children",
    kind: "relatedList",
    title: "Children",
    query: "cards:query:child:list",
    columns,
  };
}

describe("collectCardMetaOverflow", () => {
  test("title plus 4 meta columns is reported with feature, screen, count and fields", () => {
    const found = collectCardMetaOverflow([listFeature(["name", "a", "b", "c", "d"])]);
    expect(found).toEqual([
      { feature: "cards", screen: "item-list", count: 4, fields: ["a", "b", "c", "d"] },
    ]);
  });

  test("3 meta columns pass", () => {
    expect(collectCardMetaOverflow([listFeature(["name", "a", "b", "c"])])).toEqual([]);
  });

  test("hideOnNarrow, the title and the status select do not count", () => {
    const found = collectCardMetaOverflow([
      listFeature(["name", "state", "a", "b", "c", { field: "d", hideOnNarrow: true }]),
    ]);
    expect(found).toEqual([]);
  });

  test("a select column does not count as status when it is the title", () => {
    const found = collectCardMetaOverflow([listFeature(["state", "name", "a", "b", "c"])]);
    expect(found).toHaveLength(1);
    expect(found[0]?.fields).toEqual(["name", "a", "b", "c"]);
  });

  test("a projectionList is counted with every column typed text", () => {
    const feature = defineFeature("proj", (r) => {
      r.screen({
        id: "rows",
        type: "projectionList",
        query: "proj:query:rows:list",
        columns: ["t", "a", "b", "c", "d"],
      });
    });
    expect(collectCardMetaOverflow([feature])[0]).toMatchObject({ screen: "rows", count: 4 });
  });

  test("an entityList expandableRow is reported with its location", () => {
    const feature = defineFeature("exp", (r) => {
      r.entity("item", entity);
      r.screen({
        id: "item-list",
        type: "entityList",
        entity: "item",
        columns: ["name"],
        expandableRow: {
          kind: "relatedList",
          title: "Posts",
          query: "exp:query:post:list",
          columns: ["t", "a", "b", "c", "d"],
        },
      });
    });
    expect(collectCardMetaOverflow([feature])).toEqual([
      {
        feature: "exp",
        screen: "item-list",
        location: 'expandableRow "Posts"',
        count: 4,
        fields: ["a", "b", "c", "d"],
      },
    ]);
  });

  test("a relatedList in a tab of a projectionDetail is reported with the tab", () => {
    const feature = defineFeature("detail", (r) => {
      r.screen({
        id: "tenant-detail",
        type: "projectionDetail",
        query: "detail:query:tenant:get",
        layout: {
          mode: "tabs",
          sections: [
            { id: "main", title: "Main", fields: ["x"] },
            relatedSection(["t", "a", "b", "c", "d"]),
          ],
        },
      });
    });
    const found = collectCardMetaOverflow([feature]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      screen: "tenant-detail",
      location: 'tab "children" section "Children"',
      count: 4,
    });
  });

  test("a relatedList resolves select columns through its declared entity", () => {
    const feature = defineFeature("detail", (r) => {
      r.entity("item", entity);
      r.screen({
        id: "tenant-detail",
        type: "projectionDetail",
        query: "detail:query:tenant:get",
        layout: {
          sections: [{ ...relatedSection(["name", "state", "a", "b", "c"]), entity: "item" }],
        },
      });
    });
    expect(collectCardMetaOverflow([feature])).toEqual([]);
  });
});

describe("validateCardMetaOverflow", () => {
  test("throws one error listing every violation with feature, screen, count and fields", () => {
    const second = defineFeature("other", (r) => {
      r.screen({
        id: "rows",
        type: "projectionList",
        query: "other:query:rows:list",
        columns: ["t", "a", "b", "c", "d"],
      });
    });
    expect(() =>
      validateCardMetaOverflow([listFeature(["name", "a", "b", "c", "d"]), second]),
    ).toThrow(
      /Feature "cards" screen "item-list": 4 meta columns \(a, b, c, d\)[\s\S]*Feature "other" screen "rows": 4 meta columns[\s\S]*hideOnNarrow/,
    );
  });

  test("passes when nothing overflows", () => {
    expect(() => validateCardMetaOverflow([listFeature(["name", "a", "b", "c"])])).not.toThrow();
  });
});
