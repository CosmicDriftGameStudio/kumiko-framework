// Record Detail Layout Showcase — Unit Test (no DB / HTTP needed).
// Proves:
//   - header/metrics/tabs land on the registered ProjectionDetailScreenDefinition
//     exactly as declared (column names, not literals)
//   - relatedList columns collapse the string shorthand like entityList columns do
//   - the boot-validator catches the two mistakes the projectionDetail tabs
//     layout introduces: a metric with an empty label, and a tabs
//     layout with fewer than two sections

import { describe, expect, test } from "bun:test";
import {
  createRegistry,
  defineFeature,
  normalizeListColumn,
  validateBoot as validateBootRaw,
} from "@cosmicdrift/kumiko-framework/engine";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import { z } from "zod";
import { createOrderDeskFeature } from "../feature";
import {
  answerOrderList,
  answerOrderSummary,
  orderListSchema,
  orderSummarySchema,
} from "../order-board";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

const orderDesk = createOrderDeskFeature();
const registry = createRegistry([orderDesk]);

describe("record-detail-layout showcase — registration", () => {
  test("validateBoot accepts the full registered app", () => {
    expect(() => validateBoot([orderDesk])).not.toThrow();
  });

  test("order-detail registers as projectionDetail with a qualified id", () => {
    const screen = registry.getScreen("order-desk:screen:order-detail");
    expect(screen?.type).toBe("projectionDetail");
  });

  test("header and metrics store column names, not literals", () => {
    const screen = registry.getScreen("order-desk:screen:order-detail");
    if (screen?.type !== "projectionDetail") throw new Error("expected projectionDetail");
    expect(screen.header).toEqual({
      title: "customerName",
      subtitle: [
        "orderNumber",
        { field: "placedAt", format: { format: "date", dateStyle: "medium" } },
      ],
      status: "status",
    });
    expect(screen.metrics?.map((metric) => metric.field)).toEqual([
      "totalAmount",
      "outstandingAmount",
      "itemCount",
      "placedAt",
    ]);
  });

  test("layout.mode is tabs with two relatedList sections, one fields section, and one extension section", () => {
    const screen = registry.getScreen("order-desk:screen:order-detail");
    if (screen?.type !== "projectionDetail") throw new Error("expected projectionDetail");
    expect(screen.layout.mode).toBe("tabs");
    expect(screen.layout.sections.map((s) => s.kind)).toEqual([
      "relatedList",
      "relatedList",
      "fields",
      "extension",
    ]);
  });

  test("screen-level actions carry refresh-order, inline download-invoice and the payments-only record-payment", () => {
    const screen = registry.getScreen("order-desk:screen:order-detail");
    if (screen?.type !== "projectionDetail") throw new Error("expected projectionDetail");
    expect(screen.actions?.map((a) => a.id)).toEqual([
      "refresh-order",
      "download-invoice",
      "record-payment",
    ]);
    expect(screen.inlineActions).toEqual(["download-invoice"]);
  });

  test("relatedList columns carry their own header label, there is no entity to resolve it from", () => {
    const screen = registry.getScreen("order-desk:screen:order-detail");
    if (screen?.type !== "projectionDetail") throw new Error("expected projectionDetail");
    const itemsSection = screen.layout.sections[0];
    if (itemsSection?.kind !== "relatedList") throw new Error("expected relatedList");
    expect(normalizeListColumn(itemsSection.columns[0]!)).toEqual({
      field: "sku",
      label: "order-desk.col.sku",
    });
  });
});

describe("record-detail-layout showcase — guidance", () => {
  test("the orders list carries rowToneField and a hint column", () => {
    const screen = registry.getScreen("order-desk:screen:orders");
    if (screen?.type !== "projectionList") throw new Error("expected projectionList");
    expect(screen.rowToneField).toBe("tone");
    const hint = screen.columns.map((c) => normalizeListColumn(c)).find((c) => c.hint);
    expect(hint?.hint?.detailField).toBe("nextStepDue");
  });

  test("the detail screen declares breadcrumb, summary, banner and steps from query fields", () => {
    const screen = registry.getScreen("order-desk:screen:order-detail");
    if (screen?.type !== "projectionDetail") throw new Error("expected projectionDetail");
    expect(screen.breadcrumb).toEqual({ field: "path" });
    expect(screen.summary).toEqual({ field: "summaryLine", toneField: "summaryTone" });
    expect(screen.banner?.field).toBe("notice");
    expect(screen.steps?.field).toBe("steps");
    expect(screen.progress?.field).toBe("progress");
  });
});

describe("record-detail-layout showcase — work queue", () => {
  test("the orders list offers named filters as a counted select, with sort and empty state", () => {
    const screen = registry.getScreen("order-desk:screen:orders");
    if (screen?.type !== "projectionList") throw new Error("expected projectionList");
    expect(screen.namedFilters?.map((filter) => filter.id)).toEqual([
      "action-needed",
      "reminder-due",
      "ending-soon",
    ]);
    expect(screen.namedFilterFacet).toEqual({
      display: "select",
      showCounts: true,
      label: "order-desk.orders.todo",
    });
    const buttons = (screen.rowActions ?? []).filter((action) => action.display === "button");
    expect(buttons.map((action) => [action.id, action.visible])).toEqual([
      ["remind", { field: "canRemind", eq: true }],
      ["open-order", { field: "canRemind", eq: false }],
    ]);
    expect(screen.namedFilters?.[0]?.sort).toEqual({ field: "urgency", dir: "desc" });
    expect(screen.namedFilters?.[0]?.emptyState?.title).toBe("order-desk.orders.all-done");
    expect(screen.table?.totals).toEqual([
      { field: "orderNumber", kind: "count" },
      { field: "openAmount", kind: "sum" },
    ]);
  });

  test("the list query filters, sorts, counts and aggregates like the screen asks", () => {
    const ask = (payload: object) => answerOrderList(orderListSchema.parse(payload));
    const open = ask({ namedFilter: "action-needed", sort: "urgency", sortDirection: "desc" });
    if (!("rows" in open)) throw new Error("expected rows");
    expect(open.rows.map((row) => row.id)).toEqual(["o1", "o7", "o3", "o4", "o5"]);

    const counted = ask({ namedFilter: "action-needed", limit: 1, totalCount: true });
    if (!("rows" in counted)) throw new Error("expected rows");
    expect(counted.rows).toHaveLength(1);
    expect(counted.total).toBe(5);

    const none = ask({ namedFilter: "reminder-due", totalCount: true });
    if (!("rows" in none)) throw new Error("expected rows");
    expect(none.rows).toHaveLength(0);

    const totals = ask({
      aggregate: { measures: [{ field: "openAmount", kind: "sum" }] },
    });
    if (!("groups" in totals)) throw new Error("expected groups");
    expect(totals.groups[0]?.measures).toEqual([2497]);
  });

  test("the today dashboard counts through the list query and links into the filtered list", () => {
    const screen = registry.getScreen("order-desk:screen:today");
    if (screen?.type !== "dashboard") throw new Error("expected dashboard");
    expect(screen.panels.map((panel) => panel.kind)).toEqual([
      "text",
      "stat-group",
      "list",
      "list",
      "list",
      "stat-group",
    ]);
    const counts = screen.panels.find((panel) => panel.id === "queue-counts");
    if (counts?.kind !== "stat-group") throw new Error("expected stat-group");
    expect(counts.stats.map((stat) => stat.navigate?.namedFilter)).toEqual([
      "action-needed",
      "reminder-due",
      "ending-soon",
    ]);
  });
});

describe("record-detail-layout showcase — board gaps", () => {
  test("the orders list declares sort options, a summary query and a self-sizing hint column", () => {
    const screen = registry.getScreen("order-desk:screen:orders");
    if (screen?.type !== "projectionList") throw new Error("expected projectionList");
    expect(screen.sortOptions?.map((option) => [option.field, option.dir])).toEqual([
      ["urgency", "desc"],
      ["customerName", "asc"],
    ]);
    expect(screen.table?.summaryRow?.query).toBe("order-desk:query:order:summary");
    const hint = screen.columns.map((c) => normalizeListColumn(c)).find((c) => c.hint);
    expect([hint?.width, hint?.minWidth]).toEqual([320, 240]);
  });

  test("the summary query follows the named filter", () => {
    const all = answerOrderSummary(orderSummarySchema.parse({}));
    const open = answerOrderSummary(orderSummarySchema.parse({ namedFilter: "action-needed" }));
    expect(all.items[0]?.value).toBe(8);
    expect(open.items[0]?.value).toBe(5);
    expect(all.items.map((item) => item.label)).toEqual(["Orders", "Open", "Overdue"]);
  });

  test("the today board links its list and stat group and the detail places progress beside the steps", () => {
    const today = registry.getScreen("order-desk:screen:today");
    if (today?.type !== "dashboard") throw new Error("expected dashboard");
    const now = today.panels.find((panel) => panel.kind === "list" && panel.showTotal === true);
    if (now?.kind !== "list") throw new Error("expected the now list");
    expect(now.footerLink?.namedFilter).toBe("action-needed");
    const counts = today.panels.find((panel) => panel.id === "queue-counts");
    if (counts?.kind !== "stat-group") throw new Error("expected stat-group");
    expect([counts.layout, counts.link?.screen]).toEqual(["strip", "orders"]);

    const detail = registry.getScreen("order-desk:screen:order-detail");
    if (detail?.type !== "projectionDetail") throw new Error("expected projectionDetail");
    expect(detail.progress?.placement).toBe("beside-steps");
    expect(detail.metricsPlacement).toEqual({ narrow: "after-guidance" });
    expect(detail.metrics?.map((metric) => metric.subField)).toContain("totalNote");
  });
});

describe("record-detail-layout showcase — empty states", () => {
  test("the payments tab declares a record-dependent empty text ahead of its default", () => {
    const screen = registry.getScreen("order-desk:screen:order-detail");
    if (screen?.type !== "projectionDetail") throw new Error("expected projectionDetail");
    const payments = screen.layout.sections.find((section) => section.id === "payments");
    if (payments?.kind !== "relatedList") throw new Error("expected the payments relatedList");
    expect(payments.emptyState).toEqual({
      title: "order-desk.payments.empty",
      variants: [
        { when: { field: "status", eq: "pending" }, title: "order-desk.payments.empty-pending" },
      ],
    });
  });
});

describe("record-detail-layout showcase — boot-validator catches author mistakes", () => {
  test("metric with an empty label fails boot — no fallback to the raw column name", () => {
    const broken = defineFeature("broken-order-desk", (r) => {
      r.queryHandler({
        name: "order:detail",
        schema: z.object({ id: z.string() }),
        handler: async () => ({ id: "1" }),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.screen({
        id: "order-detail",
        type: "projectionDetail",
        query: "broken-order-desk:query:order:detail",
        metrics: [{ field: "totalAmount", label: "" }],
        layout: { sections: [{ title: "Details", fields: ["id"] }] },
      });
    });
    expect(() => validateBoot([broken])).toThrow(/metric "totalAmount" has no "label"/);
  });

  test("a hint column naming an empty detail field fails boot", () => {
    const broken = defineFeature("broken-order-desk-hint", (r) => {
      r.queryHandler({
        name: "order:list",
        schema: z.object({}),
        handler: async () => ({ rows: [] }),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.screen({
        id: "orders",
        type: "projectionList",
        query: "broken-order-desk-hint:query:order:list",
        columns: [{ field: "nextStep", hint: { detailField: "" } }],
      });
    });
    expect(() => validateBoot([broken])).toThrow(/list\/guidance-field-empty/);
  });

  test("tabs with only one section fails boot", () => {
    const broken = defineFeature("broken-order-desk-tabs", (r) => {
      r.queryHandler({
        name: "order:detail",
        schema: z.object({ id: z.string() }),
        handler: async () => ({ id: "1" }),
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.screen({
        id: "order-detail",
        type: "projectionDetail",
        query: "broken-order-desk-tabs:query:order:detail",
        layout: {
          mode: "tabs",
          sections: [{ id: "only", title: "Only", fields: ["id"] }],
        },
      });
    });
    expect(() => validateBoot([broken])).toThrow(/tabs need at least 2 sections/);
  });
});
