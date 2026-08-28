// Record Detail Layout Showcase — a projectionDetail screen with the
// "Akte" (case file) layout:
//   1. `header` renders the query row's customer/order/status columns above
//      the layout — the identity a support agent scans first.
//   2. `metrics` renders a labeled band of key numbers from the same row —
//      labels come from `fieldLabels`, there is no fallback to the raw
//      column name.
//   3. `layout.mode: "tabs"` splits the record into three tabs: two
//      `relatedList` sections (own query, own pagination, mounts only when
//      active) and one `fields` section (master data from the detail row).
//
// projectionDetail has no entity — it binds to an explicit query instead, so
// every field name below (header, metrics, fields) is a column of that
// query's row, not an entity field.

import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

const rowIdSchema = z.object({ id: z.string() });

export function createOrderDeskFeature(): FeatureDefinition {
  return defineFeature("order-desk", (r) => {
    r.systemScope();

    r.queryHandler(
      "order:detail",
      rowIdSchema,
      async (query) => ({
        id: query.payload.id,
        customerName: "Aiko Tanaka",
        orderNumber: "SO-10482",
        status: "processing",
        totalAmount: "€ 1,248.00",
        outstandingAmount: "€ 312.00",
        itemCount: "3",
        placedAt: "2026-08-21",
        shippingAddress: "Karl-Marx-Straße 12, 12043 Berlin",
        billingAddress: "Karl-Marx-Straße 12, 12043 Berlin",
        salesRep: "Jonas Weber",
      }),
      { access: { roles: ["Support", "Admin"] } },
    );

    r.queryHandler(
      "order:items",
      rowIdSchema,
      async () => ({
        rows: [
          { sku: "KB-100", description: "Mechanical keyboard", quantity: 1, unitPrice: 148 },
          { sku: "MS-220", description: "Wireless mouse", quantity: 2, unitPrice: 45 },
          { sku: "PAD-01", description: "Desk mat", quantity: 1, unitPrice: 22 },
        ],
      }),
      { access: { roles: ["Support", "Admin"] } },
    );

    r.queryHandler(
      "order:payments",
      rowIdSchema,
      async () => ({
        rows: [
          { paidAt: "2026-08-21", amount: 936, method: "card", status: "settled" },
          { paidAt: "2026-08-25", amount: 312, method: "invoice", status: "pending" },
        ],
      }),
      { access: { roles: ["Support", "Admin"] } },
    );

    r.screen({
      id: "order-detail",
      type: "projectionDetail",
      query: "order-desk:query:order:detail",
      header: { title: "customerName", subtitle: "orderNumber", status: "status" },
      metrics: ["totalAmount", "outstandingAmount", "itemCount", "placedAt"],
      fieldLabels: {
        totalAmount: "order-desk.metric.totalAmount",
        outstandingAmount: "order-desk.metric.outstandingAmount",
        itemCount: "order-desk.metric.itemCount",
        placedAt: "order-desk.metric.placedAt",
      },
      layout: {
        mode: "tabs",
        sections: [
          {
            id: "items",
            kind: "relatedList",
            title: "order-desk.tab.items",
            query: "order-desk:query:order:items",
            columns: [
              "sku",
              "description",
              "quantity",
              { field: "unitPrice", renderer: { format: "currency", symbol: "€" } },
            ],
          },
          {
            id: "payments",
            kind: "relatedList",
            title: "order-desk.tab.payments",
            query: "order-desk:query:order:payments",
            columns: [
              "paidAt",
              { field: "amount", renderer: { format: "currency", symbol: "€" } },
              "method",
              "status",
            ],
          },
          {
            id: "details",
            kind: "fields",
            title: "order-desk.tab.details",
            fields: ["shippingAddress", "billingAddress", "salesRep"],
          },
        ],
      },
      access: { roles: ["Support", "Admin"] },
    });
  });
}
