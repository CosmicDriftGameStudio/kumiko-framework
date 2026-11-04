// Record Detail Layout Showcase — a projectionDetail screen with the
// "Akte" (case file) layout:
//   1. `header` renders the query row's customer/order/status columns above
//      the layout — the identity a support agent scans first.
//   2. `metrics` renders a labeled band of key numbers from the same row —
//      each metric carries its own i18n `label`, there is no fallback to the
//      raw column name.
//   3. `layout.mode: "tabs"` splits the record into four tabs: two
//      `relatedList` sections (own query, own pagination, mounts only when
//      active), one `fields` section (master data from the detail row), and
//      one `extension` section (a plugin-mounted component, fw#3234 padding-
//      parity check — every tab kind must sit in the same Card padding, no
//      section carries extra chrome of its own).
//   4. The payments tab's emptyState picks its text from the order record through `variants`.
//   5. A screen-level `actions` entry (fw#3234) renders next to the header,
//      not inside any tab's Card. `inlineActions` keeps download-invoice a visible
//      button next to it where the page header would otherwise fold it into the menu.
//
//   6. `showOnTabs` limits the record-payment action to the payments tab.
//   7. Guidance: the `orders` projectionList tints rows via `rowToneField`, shows a
//      "to do" hint column (sentence, detail, tone, a "Why?" reason) and offers a
//      next-step action per row. The detail screen adds `breadcrumb`, `summary`,
//      `banner` and `steps`, each reading a query field; empty values drop out.
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

    r.queryHandler({
      name: "order:list",
      schema: z.object({}),
      handler: async () => ({
        rows: [
          {
            id: "o1",
            orderNumber: "SO-10482",
            customerName: "Aiko Tanaka",
            tone: "bad",
            nextStep: "Send payment reminder",
            nextStepDue: "by Friday",
            nextStepReason: "312 EUR is 14 days overdue",
            canRemind: true,
          },
          {
            id: "o2",
            orderNumber: "SO-10483",
            customerName: "Jonas Weber",
            tone: "ok",
            nextStep: "",
            nextStepDue: "",
            nextStepReason: "",
            canRemind: false,
          },
        ],
        nextCursor: null,
      }),
      access: { roles: ["Support", "Admin"] },
    });

    r.queryHandler({
      name: "order:detail",
      schema: rowIdSchema,
      handler: async (query) => ({
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
        path: [{ label: "Orders" }, { label: "SO-10482" }],
        summaryLine: "Waiting for the second payment",
        summaryTone: "warn",
        notice: { title: "Payment overdue", text: "312 EUR is 14 days overdue", tone: "bad" },
        steps: [
          {
            id: "remind",
            title: "Send payment reminder",
            detail: "by Friday",
            tone: "warn",
            why: "The invoice is 14 days overdue",
          },
          { id: "escalate", title: "Escalate to accounting" },
        ],
      }),
      access: { roles: ["Support", "Admin"] },
    });

    r.queryHandler({
      name: "order:items",
      schema: rowIdSchema,
      handler: async () => ({
        rows: [
          { sku: "KB-100", description: "Mechanical keyboard", quantity: 1, unitPrice: 148 },
          { sku: "MS-220", description: "Wireless mouse", quantity: 2, unitPrice: 45 },
          { sku: "PAD-01", description: "Desk mat", quantity: 1, unitPrice: 22 },
        ],
      }),
      access: { roles: ["Support", "Admin"] },
    });

    r.queryHandler({
      name: "order:payments",
      schema: rowIdSchema,
      handler: async () => ({
        rows: [
          { paidAt: "2026-08-21", amount: 936, method: "card", status: "settled" },
          { paidAt: "2026-08-25", amount: 312, method: "invoice", status: "pending" },
        ],
      }),
      access: { roles: ["Support", "Admin"] },
    });

    r.screen({
      id: "orders",
      type: "projectionList",
      query: "order-desk:query:order:list",
      rowToneField: "tone",
      columns: [
        { field: "orderNumber" },
        { field: "customerName" },
        {
          field: "nextStep",
          hint: {
            detailField: "nextStepDue",
            reasonField: "nextStepReason",
            emptyLabel: "order-desk.orders.nothing-open",
          },
        },
      ],
      rowActions: [
        {
          kind: "navigate",
          id: "open",
          label: "order-desk.action.open",
          screen: "order-detail",
          rowClick: true,
        },
        {
          kind: "navigate",
          id: "remind",
          label: "order-desk.action.remind",
          screen: "order-detail",
          display: "link",
          visible: { field: "canRemind", eq: true },
        },
      ],
      access: { roles: ["Support", "Admin"] },
    });

    r.screen({
      id: "order-detail",
      type: "projectionDetail",
      query: "order-desk:query:order:detail",
      header: {
        title: "customerName",
        // Parts are joined by a separator; `format` formats the raw field value.
        subtitle: [
          "orderNumber",
          { field: "placedAt", format: { format: "date", dateStyle: "medium" } },
        ],
        status: "status",
      },
      breadcrumb: { field: "path" },
      summary: { field: "summaryLine", toneField: "summaryTone" },
      banner: {
        field: "notice",
        actions: [
          {
            kind: "navigate",
            id: "banner-open",
            label: "order-desk.action.recordPayment",
            screen: "order-detail",
            icon: "plus",
          },
        ],
      },
      steps: {
        field: "steps",
        title: "order-desk.steps.title",
        emptyLabel: "order-desk.steps.empty",
        actions: [
          {
            kind: "navigate",
            id: "step-open",
            label: "order-desk.action.refreshOrder",
            screen: "order-detail",
            icon: "refresh",
          },
        ],
      },
      metrics: [
        { field: "totalAmount", label: "order-desk.metric.totalAmount" },
        { field: "outstandingAmount", label: "order-desk.metric.outstandingAmount" },
        { field: "itemCount", label: "order-desk.metric.itemCount" },
        { field: "placedAt", label: "order-desk.metric.placedAt" },
      ],
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
            emptyState: {
              title: "order-desk.payments.empty",
              variants: [
                {
                  when: { field: "status", eq: "pending" },
                  title: "order-desk.payments.empty-pending",
                },
              ],
            },
          },
          {
            id: "details",
            kind: "fields",
            title: "order-desk.tab.details",
            fields: ["shippingAddress", "billingAddress", "salesRep"],
          },
          {
            id: "internal-note",
            kind: "extension",
            title: "order-desk.tab.internalNote",
            component: { react: { __component: "OrderInternalNote" } },
            entityName: "order",
          },
        ],
      },
      actions: [
        {
          kind: "navigate",
          id: "refresh-order",
          label: "order-desk.action.refreshOrder",
          screen: "order-detail",
          icon: "refresh",
        },
        {
          kind: "navigate",
          id: "download-invoice",
          label: "order-desk.action.downloadInvoice",
          screen: "order-detail",
          icon: "download",
        },
        {
          kind: "navigate",
          id: "record-payment",
          label: "order-desk.action.recordPayment",
          screen: "order-detail",
          icon: "plus",
          showOnTabs: ["payments"],
        },
      ],
      inlineActions: ["download-invoice"],
      access: { roles: ["Support", "Admin"] },
    });
  });
}
