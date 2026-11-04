import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
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
const SORTABLE_LIST_SCHEMA = z.object({
  sort: z.string().optional(),
  sortDirection: z.enum(["asc", "desc"]).optional(),
  namedFilter: z.string().optional(),
});

type ListFeatureOptions = {
  readonly listSchema?: z.ZodObject;
  readonly summarySchema?: z.ZodObject;
  readonly screen?: Record<string, unknown>;
};

function listFeature(options: ListFeatureOptions) {
  return defineFeature("shop", (r) => {
    r.queryHandler({
      name: "order:list",
      schema: options.listSchema ?? SORTABLE_LIST_SCHEMA,
      handler: async () => ({ rows: [], nextCursor: null }),
      access: OPEN_TO_ALL,
    });
    if (options.summarySchema !== undefined) {
      r.queryHandler({
        name: "order:summary",
        schema: options.summarySchema,
        handler: async () => ({ items: [] }),
        access: OPEN_TO_ALL,
      });
    }
    r.screen({
      id: "orders",
      type: "projectionList",
      query: "shop:query:order:list",
      columns: [{ field: "number", label: "shop:col:number" }, "urgency"],
      defaultSort: { field: "number", dir: "asc" },
      ...options.screen,
    } as never);
  });
}

const URGENCY_OPTION = { field: "urgency", dir: "desc", label: "shop:sort:urgency" };
const SUMMARY_QUERY = "shop:query:order:summary";

describe("projectionList sortOptions", () => {
  test("a query that sorts and lists the field boots", () => {
    const ids = ruleIdsOf([listFeature({ screen: { sortOptions: [URGENCY_OPTION] } })]);
    expect(ids).not.toContain("list/sort-option-not-sortable");
  });

  test("a query without sort and sortDirection is list/sort-option-not-sortable", () => {
    const feature = listFeature({
      listSchema: z.object({}),
      screen: { sortOptions: [URGENCY_OPTION], defaultSort: undefined },
    });
    expect(ruleIdsOf([feature])).toContain("list/sort-option-not-sortable");
  });

  test("a field the query sorts by needs no column of its own", () => {
    const feature = listFeature({
      screen: { sortOptions: [{ field: "hidden", dir: "asc", label: "shop:sort:hidden" }] },
    });
    expect(ruleIdsOf([feature])).not.toContain("list/sort-option-not-sortable");
  });
});

describe("table.summaryRow", () => {
  const withNamedFilter = { namedFilters: [{ id: "open", label: "shop:filter:open" }] };

  test("a registered query that accepts the list keys boots", () => {
    const feature = listFeature({
      summarySchema: z.object({ namedFilter: z.string().optional() }),
      screen: { ...withNamedFilter, table: { summaryRow: { query: SUMMARY_QUERY } } },
    });
    const ids = ruleIdsOf([feature]);
    expect(ids).not.toContain("list/summary-row-query-unknown");
    expect(ids).not.toContain("list/summary-row-query-accepts-list-keys");
  });

  test("an unregistered query is list/summary-row-query-unknown", () => {
    const feature = listFeature({
      screen: { table: { summaryRow: { query: SUMMARY_QUERY } } },
    });
    expect(ruleIdsOf([feature])).toContain("list/summary-row-query-unknown");
  });

  test("a schema without the namedFilter key the list sends is list/summary-row-query-accepts-list-keys", () => {
    const feature = listFeature({
      summarySchema: z.object({}),
      screen: { ...withNamedFilter, table: { summaryRow: { query: SUMMARY_QUERY } } },
    });
    expect(ruleIdsOf([feature])).toContain("list/summary-row-query-accepts-list-keys");
  });

  test("a summaryRow without a query is list/summary-row-shape", () => {
    const feature = listFeature({ screen: { table: { summaryRow: { query: "" } } } });
    expect(ruleIdsOf([feature])).toContain("list/summary-row-shape");
  });
});

describe("hint column width without table.resizing", () => {
  const hint = { emptyLabel: "shop:nothing" };

  test("a hint column may state width and minWidth", () => {
    const feature = listFeature({
      screen: {
        columns: [{ field: "number", label: "shop:col:number", hint, width: 320, minWidth: 240 }],
      },
    });
    expect(ruleIdsOf([feature])).not.toContain("list-table/column-width-without-resizing");
  });

  test("any other column still needs table.resizing", () => {
    const feature = listFeature({
      screen: { columns: [{ field: "number", label: "shop:col:number", width: 320 }] },
    });
    expect(ruleIdsOf([feature])).toContain("list-table/column-width-without-resizing");
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

const NOW_LIST = {
  kind: "list",
  id: "now",
  label: "shop:today:now",
  query: "shop:query:order:now",
  columns: [{ field: "number" }],
};

const STAT = {
  kind: "stat",
  id: "open",
  label: "shop:today:open",
  query: "shop:query:order:now",
  valueField: "total",
};

describe("dashboard list footerLink and stat-group link", () => {
  test("a footerLink to a list screen with its namedFilter boots", () => {
    const ids = ruleIdsOf([
      dashboardFeature([
        {
          ...NOW_LIST,
          footerLink: { label: "shop:today:all", screen: "orders", namedFilter: "open" },
        },
      ]),
    ]);
    expect(ids).not.toContain("dashboard/panel-link-target");
  });

  test("a footerLink to an unknown screen is dashboard/panel-link-target", () => {
    const ids = ruleIdsOf([
      dashboardFeature([
        { ...NOW_LIST, footerLink: { label: "shop:today:all", screen: "nowhere" } },
      ]),
    ]);
    expect(ids).toContain("dashboard/panel-link-target");
  });

  test("a footerLink namedFilter the target does not declare is rejected", () => {
    const ids = ruleIdsOf([
      dashboardFeature([
        {
          ...NOW_LIST,
          footerLink: { label: "shop:today:all", screen: "orders", namedFilter: "x" },
        },
      ]),
    ]);
    expect(ids).toContain("dashboard/panel-link-target");
  });

  test("a stat-group link to an unknown screen reuses the rule", () => {
    const ids = ruleIdsOf([
      dashboardFeature([
        {
          kind: "stat-group",
          id: "inbox",
          label: "shop:today:inbox",
          layout: "strip",
          link: { label: "shop:today:all", screen: "nowhere" },
          stats: [STAT],
        },
      ]),
    ]);
    expect(ids).toContain("dashboard/panel-link-target");
  });
});

describe("dashboard stat navigate to a custom screen", () => {
  test("a stat may navigate to a custom screen", () => {
    const ids = ruleIdsOf([dashboardFeature([{ ...STAT, navigate: { screen: "help" } }])]);
    expect(ids.filter((id) => id.includes("stat-navigate"))).toEqual([]);
  });

  test("namedFilter on a custom screen target is dashboard/stat-navigate-custom-with-filter", () => {
    const ids = ruleIdsOf([
      dashboardFeature([{ ...STAT, navigate: { screen: "help", namedFilter: "open" } }]),
    ]);
    expect(ids).toContain("dashboard/stat-navigate-custom-with-filter");
  });
});

describe("metrics subField", () => {
  function detailFeature(outputFields: readonly string[]) {
    return defineFeature("shop", (r) => {
      r.queryHandler({
        name: "order:detail",
        schema: z.object({}),
        handler: async () => ({}),
        access: OPEN_TO_ALL,
        outputSchema: z.object(Object.fromEntries(outputFields.map((f) => [f, z.string()]))),
      });
      r.screen({
        id: "order-detail",
        type: "projectionDetail",
        query: "shop:query:order:detail",
        layout: { sections: [{ title: "s", fields: ["total"] }] },
        metrics: [{ field: "total", label: "shop:metric:total", subField: "note" }],
      } as never);
    });
  }

  test("a subField missing from the outputSchema is query/output-field-missing", () => {
    expect(ruleIdsOf([detailFeature(["total"])])).toContain("query/output-field-missing");
  });

  test("a subField present in the outputSchema boots", () => {
    expect(ruleIdsOf([detailFeature(["total", "note"])])).not.toContain(
      "query/output-field-missing",
    );
  });
});
