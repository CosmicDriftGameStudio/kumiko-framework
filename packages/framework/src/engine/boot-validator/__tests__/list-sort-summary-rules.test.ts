import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
import { createEntity, createTextField } from "../../factories.ts";
import { BootValidationError } from "../boot-rule.ts";

function ruleIdsOf(features: Parameters<typeof validateBootRaw>[0]): readonly string[] {
  try {
    validateBootRaw(withBootValidatorFixture(features));
  } catch (e) {
    if (e instanceof BootValidationError) return e.violations.map((v) => v.ruleId);
    throw e;
  }
  return [];
}

const OPEN_TO_ALL = { openToAll: { reason: "test handler callable by any signed-in test user" } };
const SUMMARY_QUERY = "shop:query:order:summary";
const URGENCY_OPTION = { field: "urgency", dir: "desc", label: "shop:sort:urgency" };
const NUMBER_OPTION = { field: "number", dir: "asc", label: "shop:sort:number" };

function projectionListFeature(options: {
  readonly listSchema?: z.ZodObject;
  readonly screen?: Record<string, unknown>;
}) {
  return defineFeature("shop", (r) => {
    r.queryHandler({
      name: "order:list",
      schema:
        options.listSchema ??
        z.object({ sort: z.string().optional(), sortDirection: z.string().optional() }),
      handler: async () => ({ rows: [], nextCursor: null }),
      access: OPEN_TO_ALL,
    });
    r.screen({
      id: "orders",
      type: "projectionList",
      query: "shop:query:order:list",
      columns: ["number", "urgency"],
      defaultSort: { field: "number", dir: "asc" },
      ...options.screen,
    } as never);
  });
}

function entityListFeature(
  fieldOptions: Record<string, boolean>,
  screen: Record<string, unknown>,
  summarySchema: z.ZodObject,
) {
  return defineFeature("shop", (r) => {
    r.entity({
      name: "item",
      ...createEntity({
        fields: {
          name: createTextField({ personal: false, reason: "test_fixture", ...fieldOptions }),
        },
      }),
    });
    r.queryHandler({
      name: "order:summary",
      schema: summarySchema,
      handler: async () => ({ items: [] }),
      access: OPEN_TO_ALL,
    });
    r.screen({
      id: "item-list",
      type: "entityList",
      entity: "item",
      columns: ["name"],
      defaultSort: { field: "name", dir: "asc" },
      table: { summaryRow: { query: SUMMARY_QUERY } },
      ...screen,
    } as never);
  });
}

describe("summaryRow list keys of an entityList", () => {
  test("a searchable entity makes the list send search, so a summary query without it is rejected", () => {
    const feature = entityListFeature({ sortable: true, searchable: true }, {}, z.object({}));
    expect(ruleIdsOf([feature])).toContain("list/summary-row-query-accepts-list-keys");
  });

  test("a summary query that accepts search boots for the searchable entityList", () => {
    const feature = entityListFeature(
      { sortable: true, searchable: true },
      {},
      z.object({ search: z.string().optional() }),
    );
    expect(ruleIdsOf([feature])).not.toContain("list/summary-row-query-accepts-list-keys");
  });

  test("filterable fields make the list send filters", () => {
    const feature = entityListFeature({ sortable: true, filterable: true }, {}, z.object({}));
    expect(ruleIdsOf([feature])).toContain("list/summary-row-query-accepts-list-keys");
  });

  test("no searchable or filterable field needs no search or filters key", () => {
    const feature = entityListFeature({ sortable: true }, {}, z.object({}));
    expect(ruleIdsOf([feature])).not.toContain("list/summary-row-query-accepts-list-keys");
  });
});

describe("table.summaryRow shape", () => {
  function shapeIds(summaryRow: unknown): readonly string[] {
    return ruleIdsOf([projectionListFeature({ screen: { table: { summaryRow } } })]);
  }

  test("a summaryRow that is not an object is list/summary-row-shape", () => {
    expect(shapeIds("shop:query:order:summary")).toContain("list/summary-row-shape");
  });

  test("an empty query is list/summary-row-shape", () => {
    expect(shapeIds({ query: "" })).toContain("list/summary-row-shape");
  });

  test("params that are not an object are list/summary-row-shape", () => {
    expect(shapeIds({ query: SUMMARY_QUERY, params: "x" })).toContain("list/summary-row-shape");
  });

  test("an unknown key is rejected", () => {
    expect(shapeIds({ query: SUMMARY_QUERY, extra: 1 })).not.toEqual([]);
  });

  test("summaryRow together with totals is list/summary-row-with-totals", () => {
    const feature = projectionListFeature({
      screen: {
        table: {
          summaryRow: { query: SUMMARY_QUERY },
          totals: [{ field: "number", kind: "count" }],
        },
      },
    });
    expect(ruleIdsOf([feature])).toContain("list/summary-row-with-totals");
  });

  test("a summaryRow without totals does not trip list/summary-row-with-totals", () => {
    expect(shapeIds({ query: SUMMARY_QUERY })).not.toContain("list/summary-row-with-totals");
  });
});

describe("sortOptions list rules", () => {
  test("an empty sortOptions is list/sort-options-invalid", () => {
    expect(ruleIdsOf([projectionListFeature({ screen: { sortOptions: [] } })])).toContain(
      "list/sort-options-invalid",
    );
  });

  test("the same field and dir twice is list/sort-options-invalid", () => {
    const feature = projectionListFeature({
      screen: { sortOptions: [NUMBER_OPTION, { ...NUMBER_OPTION, label: "shop:sort:again" }] },
    });
    expect(ruleIdsOf([feature])).toContain("list/sort-options-invalid");
  });

  test("a defaultSort missing from sortOptions is list/sort-options-default-not-listed", () => {
    const feature = projectionListFeature({ screen: { sortOptions: [URGENCY_OPTION] } });
    expect(ruleIdsOf([feature])).toContain("list/sort-options-default-not-listed");
  });

  test("a defaultSort listed in sortOptions boots", () => {
    const feature = projectionListFeature({
      screen: { sortOptions: [NUMBER_OPTION, URGENCY_OPTION] },
    });
    expect(ruleIdsOf([feature])).not.toContain("list/sort-options-default-not-listed");
  });

  test("a sort enum that lacks an option field is list/sort-option-not-sortable", () => {
    const feature = projectionListFeature({
      listSchema: z.object({ sort: z.enum(["number"]), sortDirection: z.enum(["asc", "desc"]) }),
      screen: { sortOptions: [NUMBER_OPTION, URGENCY_OPTION] },
    });
    expect(ruleIdsOf([feature])).toContain("list/sort-option-not-sortable");
  });

  test("a sort enum that lists every option field boots", () => {
    const feature = projectionListFeature({
      listSchema: z.object({
        sort: z.enum(["number", "urgency"]).optional(),
        sortDirection: z.enum(["asc", "desc"]),
      }),
      screen: { sortOptions: [NUMBER_OPTION, URGENCY_OPTION] },
    });
    expect(ruleIdsOf([feature])).not.toContain("list/sort-option-not-sortable");
  });

  test("an entityList sortOption on a listed column boots", () => {
    const feature = entityListFeature(
      { sortable: true },
      { sortOptions: [{ field: "name", dir: "asc", label: "shop:sort:name" }] },
      z.object({}),
    );
    expect(ruleIdsOf([feature])).not.toContain("list/sort-option-not-sortable");
  });

  test("an entityList sortOption on a column that is not listed is list/sort-option-not-sortable", () => {
    const feature = entityListFeature(
      { sortable: true },
      { sortOptions: [{ field: "ghost", dir: "asc", label: "shop:sort:ghost" }] },
      z.object({}),
    );
    expect(ruleIdsOf([feature])).toContain("list/sort-option-not-sortable");
  });
});

describe("summaryRow on a relatedList", () => {
  test("a relatedList section with summaryRow is list/summary-row-on-related-list", () => {
    const feature = defineFeature("shop", (r) => {
      r.queryHandler({
        name: "item:rows",
        schema: z.object({}),
        handler: async () => ({ rows: [], nextCursor: null }),
        access: OPEN_TO_ALL,
      });
      r.screen({
        id: "item-detail",
        type: "projectionDetail",
        query: "shop:query:item:rows",
        layout: {
          sections: [
            {
              kind: "relatedList",
              title: "Rows",
              query: "shop:query:item:rows",
              columns: ["name"],
              table: { summaryRow: { query: SUMMARY_QUERY } },
            },
          ],
        },
      } as never);
    });
    expect(ruleIdsOf([feature])).toContain("list/summary-row-on-related-list");
  });

  test("an entityList expandableRow with summaryRow is list/summary-row-on-related-list", () => {
    const feature = entityListFeature(
      { sortable: true },
      {
        table: undefined,
        expandableRow: {
          kind: "relatedList",
          title: "shop:rows",
          query: "shop:query:order:summary",
          parentParam: "item",
          columns: ["name"],
          table: { summaryRow: { query: SUMMARY_QUERY } },
        },
      },
      z.object({}),
    );
    expect(ruleIdsOf([feature])).toContain("list/summary-row-on-related-list");
  });
});

function dashboardFeature(panels: readonly Record<string, unknown>[]) {
  return defineFeature("shop", (r) => {
    r.queryHandler({
      name: "order:now",
      schema: z.object({}),
      handler: async () => ({ rows: [] }),
      access: OPEN_TO_ALL,
    });
    r.screen({ id: "help", type: "custom", renderer: { react: "HelpScreen" } } as never);
    r.screen({
      id: "orders",
      type: "projectionList",
      query: "shop:query:order:now",
      columns: ["number"],
      namedFilters: [{ id: "open", label: "shop:filter:open" }],
    } as never);
    r.screen({ id: "overview", type: "dashboard", panels } as never);
  });
}

const STAT = {
  kind: "stat",
  id: "open",
  label: "shop:today:open",
  query: "shop:query:order:now",
  valueField: "total",
};
const LIST_PANEL = {
  kind: "list",
  id: "now",
  label: "shop:today:now",
  query: "shop:query:order:now",
  columns: [{ field: "number" }],
};
const GROUP_PANEL = {
  kind: "stat-group",
  id: "inbox",
  label: "shop:today:inbox",
  layout: "strip",
  stats: [STAT],
};

const PANEL_LINKS = [
  [
    "footerLink",
    (link: object) => ({ ...LIST_PANEL, footerLink: { label: "shop:today:all", ...link } }),
  ],
  [
    "group link",
    (link: object) => ({ ...GROUP_PANEL, link: { label: "shop:today:all", ...link } }),
  ],
] as const;

describe("dashboard panel link target", () => {
  test.each(PANEL_LINKS)("%s: an unknown screen is rejected", (_name, panelWith) => {
    expect(ruleIdsOf([dashboardFeature([panelWith({ screen: "nowhere" })])])).toContain(
      "dashboard/panel-link-target",
    );
  });

  test.each(PANEL_LINKS)("%s: namedFilter on a non-list screen is rejected", (_name, panelWith) => {
    const panel = panelWith({ screen: "help", namedFilter: "open" });
    expect(ruleIdsOf([dashboardFeature([panel])])).toContain("dashboard/panel-link-target");
  });

  test.each(PANEL_LINKS)("%s: an undeclared namedFilter is rejected", (_name, panelWith) => {
    const panel = panelWith({ screen: "orders", namedFilter: "nope" });
    expect(ruleIdsOf([dashboardFeature([panel])])).toContain("dashboard/panel-link-target");
  });

  test.each(PANEL_LINKS)("%s: non-string params are rejected", (_name, panelWith) => {
    const panel = panelWith({ screen: "orders", params: { a: 1 } });
    expect(ruleIdsOf([dashboardFeature([panel])])).toContain(
      "dashboard/stat-navigate-params-invalid",
    );
  });

  test.each(PANEL_LINKS)("%s: a declared target boots", (_name, panelWith) => {
    const panel = panelWith({ screen: "orders", namedFilter: "open", params: { a: "b" } });
    const ids = ruleIdsOf([dashboardFeature([panel])]);
    expect(ids).not.toContain("dashboard/panel-link-target");
    expect(ids).not.toContain("dashboard/stat-navigate-params-invalid");
  });
});
