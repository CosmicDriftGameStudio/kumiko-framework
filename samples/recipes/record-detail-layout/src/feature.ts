// Record Detail Layout Showcase — a work queue, a briefing dashboard and a
// projectionDetail screen with the "Akte" (case file) layout:
//   1. `header` renders the query row's customer/order/status columns above
//      the layout — the identity a support agent scans first.
//   2. `metrics` renders a labeled band of key numbers from the same row; each metric
//      carries its own i18n `label`, there is no fallback to the raw column name. Tiles take a
//      fixed `tone` or a per-record `toneField` and can jump to a tab with `navigate`.
//   3. `layout.mode: "tabs"` splits the record into four tabs: two `relatedList`
//      sections (own query, own pagination, mounts only when active, badge via `countField`),
//      one `fields` section (master data) and one `extension` section (plugin-mounted component;
//      every tab kind sits in the same Card padding, no extra chrome).
//   4. The payments tab's emptyState picks its text from the order record through `variants`.
//   5. A screen-level `actions` entry (fw#3234) renders next to the header,
//      not inside any tab's Card. `inlineActions` keeps download-invoice a visible
//      button next to it where the page header would otherwise fold it into the menu.
//   6. `showOnTabs` limits the record-payment action to the payments tab.
//   7. Guidance: the `orders` projectionList tints rows via `rowToneField`, shows a
//      "to do" hint column (sentence, detail, tone, a "Why?" reason), a badge column and
//      per-row button actions (send a reminder, or open the record). Named filters sit in one select with hit counts,
//      each with its own sort and empty state; the footer totals the rows. The detail screen adds
//      `breadcrumb`, `summary`, `banner` and `steps`, each reading a query field; empty values drop out.
//   8. The `today` dashboard composes a lead briefing, count tiles that link into the filtered
//      list, a headerless "Now" list and two narrow lists on a 12-column grid.
//   9. `focus: true` gives the detail a focused shell; phones get a top bar with the
//      record title, a back arrow to the list and the page-header overflow menu.
//
// projectionDetail binds to an explicit query, not an entity: every field name below
// (header, metrics, fields) is a column of that query's row.

import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import {
  answerBriefing,
  answerCustomers,
  answerDeadlines,
  answerMoney,
  answerNowList,
  answerOrderDetail,
  answerOrderList,
  answerOrderSummary,
  orderListSchema,
  orderSummarySchema,
} from "./order-board.ts";

const rowIdSchema = z.object({ id: z.string() });
const noPayloadSchema = z.object({});
const accessRoles = { roles: ["Support", "Admin"] } as const;

export const ORDER_LIST_QUERY = "order-desk:query:order:list";

export function createOrderDeskFeature(): FeatureDefinition {
  return defineFeature("order-desk", (r) => {
    r.systemScope();

    r.queryHandler({
      name: "order:list",
      schema: orderListSchema,
      handler: async (query) => answerOrderList(query.payload),
      access: accessRoles,
    });

    r.queryHandler({
      name: "order:summary",
      schema: orderSummarySchema,
      handler: async (query) => answerOrderSummary(query.payload),
      access: accessRoles,
    });

    r.queryHandler({
      name: "order:now",
      schema: noPayloadSchema,
      handler: async () => answerNowList(),
      access: accessRoles,
    });

    r.queryHandler({
      name: "order:briefing",
      schema: noPayloadSchema,
      handler: async () => answerBriefing(),
      access: accessRoles,
    });

    r.queryHandler({
      name: "order:deadlines",
      schema: noPayloadSchema,
      handler: async () => answerDeadlines(),
      access: accessRoles,
    });

    r.queryHandler({
      name: "order:customers",
      schema: noPayloadSchema,
      handler: async () => answerCustomers(),
      access: accessRoles,
    });

    r.queryHandler({
      name: "order:money",
      schema: noPayloadSchema,
      handler: async () => answerMoney(),
      access: accessRoles,
    });

    r.queryHandler({
      name: "order:detail",
      schema: rowIdSchema,
      handler: async (query) => answerOrderDetail(query.payload.id),
      access: accessRoles,
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
      access: accessRoles,
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
      access: accessRoles,
    });

    r.writeHandler({
      name: "order:remind",
      schema: rowIdSchema,
      handler: async (event) => ({ isSuccess: true as const, data: { id: event.payload.id } }),
      access: accessRoles,
    });

    r.translations({
      keys: {
        "screen:orders.title": { en: "Orders" },
        "screen:order-detail.title": { en: "Order" },
        "screen:today.title": { en: "Today" },
        "order-desk.orders.todo": { en: "To do" },
        "order-desk.orders.nothing-open": { en: "Nothing to do" },
        "order-desk.orders.all-done": { en: "All done" },
        "order-desk.orders.all-done-hint": { en: "No order needs you right now." },
        "order-desk.filter.action-needed": { en: "Needs action" },
        "order-desk.filter.reminder-due": { en: "Reminder due" },
        "order-desk.filter.ending-soon": { en: "Ending soon" },
        "order-desk.col.order": { en: "Order" },
        "order-desk.col.customer": { en: "Customer" },
        "order-desk.col.urgency": { en: "Urgency" },
        "order-desk.col.todo": { en: "To do" },
        "order-desk.col.open-amount": { en: "Open" },
        "order-desk.col.sku": { en: "SKU" },
        "order-desk.col.description": { en: "Description" },
        "order-desk.col.quantity": { en: "Quantity" },
        "order-desk.col.unit-price": { en: "Unit price" },
        "order-desk.col.paid-at": { en: "Paid on" },
        "order-desk.col.amount": { en: "Amount" },
        "order-desk.col.method": { en: "Method" },
        "order-desk.col.status": { en: "Status" },
        "order-desk.sort.urgency": { en: "Urgency" },
        "order-desk.sort.customer": { en: "Customer A-Z" },
        "order-desk.today.now": { en: "Now" },
        "order-desk.today.now-all": { en: "All orders needing action" },
        "order-desk.today.inbox": { en: "Inbox" },
        "order-desk.today.inbox-sub": { en: "Orders waiting for you" },
        "order-desk.today.inbox-link": { en: "All orders" },
        "order-desk.today.deadlines": { en: "Deadlines" },
        "order-desk.today.customers": { en: "Customers" },
        "order-desk.today.money": { en: "Money" },
        "order-desk.today.money-sub": { en: "Across all open orders" },
        "order-desk.today.stat.action-needed": { en: "Need action" },
        "order-desk.today.stat.reminder-due": { en: "Reminders due" },
        "order-desk.today.stat.ending-soon": { en: "Ending soon" },
        "order-desk.today.stat.open": { en: "Open" },
        "order-desk.today.stat.overdue": { en: "Overdue" },
        "order-desk.today.stat.collected": { en: "Collected" },
        "order-desk.action.open": { en: "Open" },
        "order-desk.action.remind": { en: "Send reminder" },
        "order-desk.action.open-order": { en: "Open order" },
        "order-desk.action.prepare": { en: "Let the assistant prepare" },
        "order-desk.action.recordPayment": { en: "Record payment" },
        "order-desk.action.refreshOrder": { en: "Refresh" },
        "order-desk.action.downloadInvoice": { en: "Download invoice" },
        "order-desk.steps.title": { en: "Next steps" },
        "order-desk.steps.empty": { en: "Nothing left to do" },
        "order-desk.metric.totalAmount": { en: "Total" },
        "order-desk.metric.outstandingAmount": { en: "Outstanding" },
        "order-desk.metric.itemCount": { en: "Items" },
        "order-desk.metric.placedAt": { en: "Placed" },
        "order-desk.tab.items": { en: "Items" },
        "order-desk.tab.payments": { en: "Payments" },
        "order-desk.tab.details": { en: "Details" },
        "order-desk.tab.internalNote": { en: "Internal note" },
        "order-desk.payments.empty": { en: "No payments yet" },
        "order-desk.payments.empty-pending": { en: "A payment is pending" },
      },
    });

    r.screen({
      id: "orders",
      type: "projectionList",
      query: ORDER_LIST_QUERY,
      rowToneField: "tone",
      columns: [
        { field: "orderNumber", label: "order-desk.col.order" },
        { field: "customerName", label: "order-desk.col.customer" },
        {
          field: "urgencyLabel",
          label: "order-desk.col.urgency",
          display: "badge",
          badgeToneField: "urgencyTone",
        },
        {
          field: "nextStep",
          label: "order-desk.col.todo",
          hint: {
            detailField: "nextStepDue",
            reasonField: "nextStepReason",
            emptyLabel: "order-desk.orders.nothing-open",
          },
          width: 320,
          minWidth: 240,
        },
        { field: "openAmount", label: "order-desk.col.open-amount", hideOnNarrow: true },
      ],
      defaultSort: { field: "urgency", dir: "desc" },
      sortOptions: [
        { field: "urgency", dir: "desc", label: "order-desk.sort.urgency" },
        { field: "customerName", dir: "asc", label: "order-desk.sort.customer" },
      ],
      namedFilters: [
        {
          id: "action-needed",
          label: "order-desk.filter.action-needed",
          sort: { field: "urgency", dir: "desc" },
          emptyState: {
            title: "order-desk.orders.all-done",
            description: "order-desk.orders.all-done-hint",
          },
        },
        {
          id: "reminder-due",
          label: "order-desk.filter.reminder-due",
          emptyState: {
            title: "order-desk.orders.all-done",
            description: "order-desk.orders.all-done-hint",
          },
        },
        { id: "ending-soon", label: "order-desk.filter.ending-soon" },
      ],
      namedFilterFacet: { display: "select", showCounts: true, label: "order-desk.orders.todo" },
      table: {
        summaryRow: { query: "order-desk:query:order:summary" },
        totals: [
          { field: "orderNumber", kind: "count" },
          { field: "openAmount", kind: "sum" },
        ],
      },
      rowActions: [
        {
          kind: "navigate",
          id: "open",
          label: "order-desk.action.open",
          screen: "order-detail",
          rowClick: true,
        },
        {
          id: "remind",
          label: "order-desk.action.remind",
          handler: "order-desk:write:order:remind",
          display: "button",
          visible: { field: "canRemind", eq: true },
        },
        {
          kind: "navigate",
          id: "open-order",
          label: "order-desk.action.open-order",
          screen: "order-detail",
          display: "button",
          visible: { field: "canRemind", eq: false },
        },
      ],
      access: accessRoles,
    });

    r.screen({
      id: "today",
      type: "dashboard",
      panels: [
        {
          kind: "text",
          id: "briefing",
          span: "two-thirds",
          query: "order-desk:query:order:briefing",
        },
        {
          kind: "stat-group",
          id: "queue-counts",
          label: "order-desk.today.inbox",
          subtitle: "order-desk.today.inbox-sub",
          span: "full",
          layout: "strip",
          link: { label: "order-desk.today.inbox-link", screen: "orders" },
          stats: [
            {
              kind: "stat",
              id: "action-needed",
              label: "order-desk.today.stat.action-needed",
              query: ORDER_LIST_QUERY,
              valueField: "total",
              params: { namedFilter: "action-needed", limit: 1, totalCount: true },
              tone: "negative",
              navigate: { screen: "orders", namedFilter: "action-needed" },
            },
            {
              kind: "stat",
              id: "reminder-due",
              label: "order-desk.today.stat.reminder-due",
              query: ORDER_LIST_QUERY,
              valueField: "total",
              params: { namedFilter: "reminder-due", limit: 1, totalCount: true },
              tone: "warn",
              navigate: { screen: "orders", namedFilter: "reminder-due" },
            },
            {
              kind: "stat",
              id: "ending-soon",
              label: "order-desk.today.stat.ending-soon",
              query: ORDER_LIST_QUERY,
              valueField: "total",
              params: { namedFilter: "ending-soon", limit: 1, totalCount: true },
              navigate: { screen: "orders", namedFilter: "ending-soon" },
            },
          ],
        },
        {
          kind: "list",
          id: "now",
          label: "order-desk.today.now",
          span: "two-thirds",
          showHeader: false,
          showTotal: true,
          footerLink: {
            label: "order-desk.today.now-all",
            screen: "orders",
            namedFilter: "action-needed",
          },
          query: "order-desk:query:order:now",
          rowToneField: "tone",
          columns: [
            { field: "urgencyLabel", display: "badge", badgeToneField: "urgencyTone" },
            {
              field: "nextStep",
              hint: { detailField: "nextStepDue", reasonField: "nextStepReason" },
            },
            {
              field: "actionLabel",
              display: "button",
              linkScreenField: "actionScreen",
              linkParamsField: "actionParams",
            },
          ],
        },
        {
          kind: "list",
          id: "deadlines",
          label: "order-desk.today.deadlines",
          span: "third",
          showHeader: false,
          query: "order-desk:query:order:deadlines",
          columns: [
            { field: "due", display: "datetime" },
            { field: "title", linkScreenField: "screen", linkParamsField: "params" },
          ],
        },
        {
          kind: "list",
          id: "customers",
          label: "order-desk.today.customers",
          span: "third",
          showHeader: false,
          query: "order-desk:query:order:customers",
          rowToneField: "tone",
          columns: [
            { field: "customerName", linkScreenField: "screen", linkParamsField: "params" },
            { field: "openCount", display: "badge", badgeToneField: "openTone" },
          ],
        },
        {
          kind: "stat-group",
          id: "money",
          label: "order-desk.today.money",
          subtitle: "order-desk.today.money-sub",
          span: "two-thirds",
          stats: [
            {
              kind: "stat",
              id: "open",
              label: "order-desk.today.stat.open",
              query: "order-desk:query:order:money",
              valueField: "open",
            },
            {
              kind: "stat",
              id: "overdue",
              label: "order-desk.today.stat.overdue",
              query: "order-desk:query:order:money",
              valueField: "overdue",
              tone: "negative",
            },
            {
              kind: "stat",
              id: "collected",
              label: "order-desk.today.stat.collected",
              query: "order-desk:query:order:money",
              valueField: "collected",
              tone: "positive",
            },
          ],
        },
      ],
      access: accessRoles,
    });

    r.screen({
      id: "order-detail",
      type: "projectionDetail",
      query: "order-desk:query:order:detail",
      focus: true,
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
      progress: { field: "progress", placement: "beside-steps" },
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
          {
            kind: "navigate",
            id: "prepare",
            label: "order-desk.action.prepare",
            screen: "order-detail",
            display: "link",
            icon: "sparkles",
            visible: { field: "canPrepare", eq: true },
          },
        ],
      },
      metricsStyle: "tiles",
      metricsPlacement: { narrow: "after-guidance" },
      metrics: [
        {
          field: "totalAmount",
          label: "order-desk.metric.totalAmount",
          subField: "totalNote",
        },
        {
          field: "outstandingAmount",
          label: "order-desk.metric.outstandingAmount",
          subField: "outstandingNote",
          tone: "warn",
          toneField: "outstandingTone",
          navigate: { tab: "payments" },
        },
        {
          field: "itemCount",
          label: "order-desk.metric.itemCount",
          navigate: { tab: "items" },
        },
        { field: "placedAt", label: "order-desk.metric.placedAt" },
      ],
      layout: {
        mode: "tabs",
        sections: [
          {
            id: "items",
            kind: "relatedList",
            title: "order-desk.tab.items",
            countField: "itemsCount",
            query: "order-desk:query:order:items",
            columns: [
              { field: "sku", label: "order-desk.col.sku" },
              { field: "description", label: "order-desk.col.description" },
              { field: "quantity", label: "order-desk.col.quantity" },
              {
                field: "unitPrice",
                label: "order-desk.col.unit-price",
                renderer: { format: "currency", symbol: "€" },
              },
            ],
          },
          {
            id: "payments",
            kind: "relatedList",
            title: "order-desk.tab.payments",
            countField: "paymentsCount",
            query: "order-desk:query:order:payments",
            columns: [
              { field: "paidAt", label: "order-desk.col.paid-at" },
              {
                field: "amount",
                label: "order-desk.col.amount",
                renderer: { format: "currency", symbol: "€" },
              },
              { field: "method", label: "order-desk.col.method" },
              { field: "status", label: "order-desk.col.status" },
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
      access: accessRoles,
    });
  });
}
