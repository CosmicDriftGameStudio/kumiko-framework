// Record Detail Layout Showcase — Unit Test (no DB / HTTP needed).
// Proves:
//   - header/metrics/tabs land on the registered ProjectionDetailScreenDefinition
//     exactly as declared (column names, not literals)
//   - relatedList columns collapse the string shorthand like entityList columns do
//   - the boot-validator catches the two mistakes the projectionDetail tabs
//     layout introduces: a metric without a fieldLabels entry, and a tabs
//     layout with fewer than two sections

import { describe, expect, test } from "bun:test";
import {
  createRegistry,
  defineFeature,
  normalizeListColumn,
  validateBoot as validateBootRaw,
} from "@cosmicdrift/kumiko-framework/engine";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-framework/testing";
import { z } from "zod";
import { createOrderDeskFeature } from "../feature";

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
      subtitle: "orderNumber",
      status: "status",
    });
    expect(screen.metrics).toEqual(["totalAmount", "outstandingAmount", "itemCount", "placedAt"]);
  });

  test("layout.mode is tabs with two relatedList sections and one fields section", () => {
    const screen = registry.getScreen("order-desk:screen:order-detail");
    if (screen?.type !== "projectionDetail") throw new Error("expected projectionDetail");
    expect(screen.layout.mode).toBe("tabs");
    expect(screen.layout.sections.map((s) => s.kind)).toEqual([
      "relatedList",
      "relatedList",
      "fields",
    ]);
  });

  test("relatedList columns collapse string shorthand into the object form", () => {
    const screen = registry.getScreen("order-desk:screen:order-detail");
    if (screen?.type !== "projectionDetail") throw new Error("expected projectionDetail");
    const itemsSection = screen.layout.sections[0];
    if (itemsSection?.kind !== "relatedList") throw new Error("expected relatedList");
    expect(normalizeListColumn(itemsSection.columns[0]!)).toEqual({ field: "sku" });
  });
});

describe("record-detail-layout showcase — boot-validator catches author mistakes", () => {
  test("metric without a fieldLabels entry fails boot — no fallback to the raw column name", () => {
    const broken = defineFeature("broken-order-desk", (r) => {
      r.queryHandler("order:detail", z.object({ id: z.string() }), async () => ({ id: "1" }), {
        access: { openToAll: true },
      });
      r.screen({
        id: "order-detail",
        type: "projectionDetail",
        query: "broken-order-desk:query:order:detail",
        metrics: ["totalAmount"],
        layout: { sections: [{ title: "Details", fields: ["id"] }] },
      });
    });
    expect(() => validateBoot([broken])).toThrow(
      /metric "totalAmount" has no entry in fieldLabels/,
    );
  });

  test("tabs with only one section fails boot", () => {
    const broken = defineFeature("broken-order-desk-tabs", (r) => {
      r.queryHandler("order:detail", z.object({ id: z.string() }), async () => ({ id: "1" }), {
        access: { openToAll: true },
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
