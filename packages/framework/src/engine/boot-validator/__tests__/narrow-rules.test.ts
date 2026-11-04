// Boot rules of the phone variants: dashboard narrow options, narrow-only columns, steps.narrowLimit.
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

function screensFeature(screens: readonly Record<string, unknown>[]) {
  return defineFeature("shop", (r) => {
    for (const name of ["order:now", "order:detail"]) {
      r.queryHandler({
        name,
        schema: z.object({}),
        handler: async () => ({ rows: [] }),
        access: OPEN_TO_ALL,
      });
    }
    for (const screen of screens) r.screen(screen as never);
  });
}

const dashboard = (panels: readonly Record<string, unknown>[]) =>
  screensFeature([
    {
      id: "orders",
      type: "projectionList",
      query: "shop:query:order:now",
      columns: ["number"],
    },
    { id: "overview", type: "dashboard", panels },
  ]);

const LIST = {
  kind: "list",
  id: "now",
  label: "shop:today:now",
  query: "shop:query:order:now",
  columns: [{ field: "number" }],
};

const FOOTER_LINK = { label: "shop:today:all", screen: "orders" };

const STAT = {
  kind: "stat",
  id: "open",
  label: "shop:today:open",
  query: "shop:query:order:now",
  valueField: "total",
};

describe("dashboard narrow rules", () => {
  test("a cards list with limit boots", () => {
    const ids = ruleIdsOf([dashboard([{ ...LIST, narrow: { layout: "cards", limit: 3 } }])]);
    expect(ids).toEqual([]);
  });

  test("a non-positive limit is rejected", () => {
    const ids = ruleIdsOf([dashboard([{ ...LIST, narrow: { limit: 0 } }])]);
    expect(ids).toContain("dashboard/list-narrow-invalid");
  });

  test("an unknown layout is rejected", () => {
    const ids = ruleIdsOf([dashboard([{ ...LIST, narrow: { layout: "grid" } }])]);
    expect(ids).toContain("dashboard/list-narrow-invalid");
  });

  test("the line layout needs a footerLink", () => {
    expect(ruleIdsOf([dashboard([{ ...LIST, narrow: { layout: "line" } }])])).toContain(
      "dashboard/list-narrow-line-without-footer-link",
    );
    expect(
      ruleIdsOf([dashboard([{ ...LIST, footerLink: FOOTER_LINK, narrow: { layout: "line" } }])]),
    ).toEqual([]);
  });

  test("stat-group columns need the cards layout and 2 to 4", () => {
    const group = { kind: "stat-group", id: "inbox", stats: [STAT, { ...STAT, id: "late" }] };
    expect(
      ruleIdsOf([
        dashboard([{ ...group, label: "shop:today:inbox", layout: "cards", columns: 3 }]),
      ]),
    ).toEqual([]);
    expect(
      ruleIdsOf([
        dashboard([{ ...group, label: "shop:today:inbox", layout: "cards", columns: 5 }]),
      ]),
    ).toContain("dashboard/stat-group-columns-invalid");
    expect(ruleIdsOf([dashboard([{ ...group, layout: "strip", columns: 3 }])])).toContain(
      "dashboard/stat-group-columns-invalid",
    );
  });

  test("a stat-group child may not hide itself", () => {
    const group = {
      kind: "stat-group",
      id: "inbox",
      label: "shop:today:inbox",
      layout: "cards",
      stats: [{ ...STAT, hideOnNarrow: true }],
    };
    expect(ruleIdsOf([dashboard([group])])).toContain("dashboard/stat-group-child-hide-on-narrow");
  });

  test("narrowBlocks need blocks", () => {
    const text = { kind: "text", id: "tips" };
    const narrowBlocks = [{ kind: "paragraph", text: "shop:today:tip" }];
    expect(ruleIdsOf([dashboard([{ ...text, narrowBlocks }])])).toContain(
      "dashboard/text-narrow-blocks-without-blocks",
    );
    expect(ruleIdsOf([dashboard([{ ...text, blocks: narrowBlocks, narrowBlocks }])])).toEqual([]);
  });
});

describe("list and detail narrow rules", () => {
  const listWith = (column: Record<string, unknown>) =>
    screensFeature([
      {
        id: "orders",
        type: "projectionList",
        query: "shop:query:order:now",
        columns: [{ field: "number" }, { field: "rent", ...column }],
      },
    ]);

  test("showOnNarrowOnly boots alone and conflicts with hideOnNarrow", () => {
    expect(ruleIdsOf([listWith({ showOnNarrowOnly: true })])).toEqual([]);
    expect(ruleIdsOf([listWith({ showOnNarrowOnly: true, hideOnNarrow: true })])).toContain(
      "list/narrow-only-conflict",
    );
  });

  test("hideOnNarrow: false and hidden: false do not conflict, a pin does", () => {
    expect(
      ruleIdsOf([listWith({ showOnNarrowOnly: true, hideOnNarrow: false, hidden: false })]),
    ).toEqual([]);
    expect(ruleIdsOf([listWith({ showOnNarrowOnly: true, pinned: "left" })])).toContain(
      "list/narrow-only-conflict",
    );
  });

  test("showOnNarrowOnly boots in a dashboard list panel", () => {
    const ids = ruleIdsOf([
      dashboard([{ ...LIST, columns: [{ field: "number", showOnNarrowOnly: true }] }]),
    ]);
    expect(ids).toEqual([]);
  });

  test("narrow.field needs the line layout and a column of the panel", () => {
    const line = { ...LIST, footerLink: FOOTER_LINK };
    expect(
      ruleIdsOf([dashboard([{ ...line, narrow: { layout: "line", field: "number" } }])]),
    ).toEqual([]);
    expect(
      ruleIdsOf([dashboard([{ ...line, narrow: { layout: "line", field: "nope" } }])]),
    ).toContain("dashboard/list-narrow-field-unknown");
    expect(
      ruleIdsOf([dashboard([{ ...line, narrow: { layout: "cards", field: "number" } }])]),
    ).toContain("dashboard/list-narrow-field-unknown");
  });

  test("narrowOrder must be a non-negative integer", () => {
    expect(ruleIdsOf([dashboard([{ ...LIST, narrowOrder: 2 }])])).toEqual([]);
    expect(ruleIdsOf([dashboard([{ ...LIST, narrowOrder: -1 }])])).toContain(
      "dashboard/narrow-order-invalid",
    );
    expect(ruleIdsOf([dashboard([{ ...LIST, narrowOrder: 1.5 }])])).toContain(
      "dashboard/narrow-order-invalid",
    );
  });

  test("narrowLabel on a stat outside a group is rejected", () => {
    expect(ruleIdsOf([dashboard([{ ...STAT, narrowLabel: "shop:today:open-short" }])])).toContain(
      "dashboard/stat-narrow-label-outside-group",
    );
  });

  test("a stat-group icon needs a label and the strip layout", () => {
    const group = { kind: "stat-group", id: "inbox", stats: [STAT, { ...STAT, id: "late" }] };
    expect(ruleIdsOf([dashboard([{ ...group, icon: "inbox" }])])).toContain(
      "dashboard/stat-group-icon-without-titled-strip",
    );
    expect(
      ruleIdsOf([
        dashboard([{ ...group, label: "shop:today:inbox", layout: "strip", icon: "inbox" }]),
      ]),
    ).toEqual([]);
    for (const layout of ["cards", undefined]) {
      expect(
        ruleIdsOf([dashboard([{ ...group, label: "shop:today:inbox", layout, icon: "inbox" }])]),
      ).toContain("dashboard/stat-group-icon-without-titled-strip");
    }
  });

  test("narrowLabel on a group child needs a titled group with the strip layout", () => {
    const group = (extra: Record<string, unknown>, narrowLabel: string) => ({
      kind: "stat-group",
      id: "inbox",
      stats: [{ ...STAT, narrowLabel }],
      ...extra,
    });
    const titledStrip = { label: "shop:today:inbox", layout: "strip" };
    expect(ruleIdsOf([dashboard([group(titledStrip, "shop:today:open-short")])])).toEqual([]);
    expect(ruleIdsOf([dashboard([group({}, "shop:today:open-short")])])).toContain(
      "dashboard/stat-narrow-label-outside-group",
    );
    expect(
      ruleIdsOf([
        dashboard([group({ label: "shop:today:inbox", layout: "cards" }, "shop:today:open-short")]),
      ]),
    ).toContain("dashboard/stat-narrow-label-outside-group");
    expect(ruleIdsOf([dashboard([group(titledStrip, " ")])])).toContain(
      "dashboard/stat-narrow-label-outside-group",
    );
  });

  test("narrowOrder on a group child is rejected, the group itself may set it", () => {
    const group = {
      kind: "stat-group",
      id: "inbox",
      label: "shop:today:inbox",
      layout: "cards",
      stats: [{ ...STAT, narrowOrder: 1 }],
    };
    expect(ruleIdsOf([dashboard([group])])).toContain("dashboard/narrow-order-invalid");
    expect(ruleIdsOf([dashboard([{ ...group, stats: [STAT], narrowOrder: 1 }])])).toEqual([]);
  });

  test("hint.narrowDetailField needs hint.detailField", () => {
    const listWithHint = (hint: Record<string, unknown>) =>
      dashboard([{ ...LIST, columns: [{ field: "number", hint }] }]);
    expect(ruleIdsOf([listWithHint({ narrowDetailField: "number" })])).toContain(
      "list/narrow-detail-field-without-detail-field",
    );
    expect(
      ruleIdsOf([listWithHint({ detailField: "number", narrowDetailField: "number" })]),
    ).toEqual([]);
  });

  test("rowLink.paramField must be a field of the query output", () => {
    const withOutput = (rowLink: Record<string, unknown>) =>
      defineFeature("shop", (r) => {
        r.queryHandler({
          name: "order:now",
          schema: z.object({}),
          handler: async () => ({ rows: [] }),
          access: OPEN_TO_ALL,
          outputSchema: z.object({ rows: z.array(z.object({ number: z.string() })) }),
        });
        r.screen({
          id: "orders",
          type: "projectionList",
          query: "shop:query:order:now",
          columns: ["number"],
        } as never);
        r.screen({
          id: "overview",
          type: "dashboard",
          panels: [{ ...LIST, rowLink }],
        } as never);
      });
    expect(ruleIdsOf([withOutput({ screen: "orders", paramField: "number" })])).toEqual([]);
    expect(ruleIdsOf([withOutput({ screen: "orders", paramField: "nope" })])).toContain(
      "query/output-field-missing",
    );
  });

  test("rowLink needs an existing screen, a non-empty paramField and a known icon", () => {
    expect(
      ruleIdsOf([dashboard([{ ...LIST, rowLink: { screen: "orders", icon: "chevron" } }])]),
    ).toEqual([]);
    expect(ruleIdsOf([dashboard([{ ...LIST, rowLink: { screen: "missing" } }])]).length).toBe(1);
    expect(
      ruleIdsOf([dashboard([{ ...LIST, rowLink: { screen: "orders", paramField: " " } }])]),
    ).toContain("dashboard/list-row-link-invalid");
    expect(
      ruleIdsOf([dashboard([{ ...LIST, rowLink: { screen: "orders", icon: "star" } }])]),
    ).toContain("dashboard/list-row-link-invalid");
  });

  test("steps.narrowLimit must be a positive integer", () => {
    const detail = (narrowLimit: number) =>
      screensFeature([
        {
          id: "order-detail",
          type: "projectionDetail",
          query: "shop:query:order:detail",
          layout: { sections: [{ title: "Order", fields: ["name"] }] },
          steps: { field: "steps", narrowLimit },
        },
      ]);
    expect(ruleIdsOf([detail(3)])).toEqual([]);
    expect(ruleIdsOf([detail(0)])).toContain("projection-detail/steps-narrow-limit-invalid");
  });
});
