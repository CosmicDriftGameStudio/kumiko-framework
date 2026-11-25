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
//      each with its own sort and empty state; the summary row totals the rows. The detail screen adds
//      `breadcrumb`, `summary`, `banner` and `steps`, each reading a query field; empty values drop out.
//   8. The `today` dashboard composes a lead briefing, count tiles that link into the filtered
//      list, a headerless "Now" list and two narrow lists on a 12-column grid.
//   9. Phone variants: `hideOnNarrow` drops panels, a list panel's `narrow` turns it into limited cards or a
//      one-line link, `narrowBlocks` shortens the briefing, `showOnNarrowOnly` adds card-only meta, and the
//      detail shows `summary.narrowField`, `steps.narrowLimit` and no `progress` chain under sm.
//  10. `focus: true` gives the detail a focused shell; phones get a top bar with the
//      record title, a back arrow to the list and the page-header overflow menu.
//
//  11. Phone card values: two `showOnNarrowOnly` columns with `narrowInline` stand side by side on one line.
//      The named-filter select sits behind the filter icon on phones (`narrowPlacement: "behind-filter"`),
//      and the "reminder due" empty state fills its description from a query (`emptyState.paramsQuery`).
//
// projectionDetail binds to an explicit query, not an entity: every field name below
// (header, metrics, fields) is a column of that query's row.

import {
  createEntity,
  createFileField,
  createTextField,
  defineFeature,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { ORDER_DESK_I18N } from "./i18n.ts";
import {
  accessRoles,
  answerBriefing,
  answerCustomers,
  answerDeadlines,
  answerMoney,
  answerNextReminder,
  answerNowList,
  answerOrderDetail,
  answerOrderList,
  answerOrderSummary,
  orderListSchema,
  orderSummarySchema,
} from "./order-board.ts";
import {
  orderDetailScreen,
  orderFactsScreen,
  orderRemindScreen,
  ordersScreen,
  todayScreen,
} from "./screens.ts";

// The host of the detail's upload form: its file field `attachment` is what the form's file field is stored as.
const orderAttachmentEntity = createEntity({
  name: "order-attachment",
  table: "read_order_attachments",
  fields: {
    title: createTextField({ personal: false, reason: "is_business_data", maxLength: 200 }),
    attachment: createFileField(),
  },
});

const rowIdSchema = z.object({ id: z.string() });
const noPayloadSchema = z.object({});

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
      name: "order:next-reminder",
      schema: noPayloadSchema,
      handler: async () => answerNextReminder(),
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
      outputSchema: z.object({
        rows: z.array(
          z.object({
            id: z.string(),
            due: z.string(),
            title: z.string(),
            screen: z.string(),
            params: z.object({ entityId: z.string() }),
          }),
        ),
      }),
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
          { sku: "KB-100", description: "Mechanical keyboard", quantity: 1, unitPrice: 14800 },
          { sku: "MS-220", description: "Wireless mouse", quantity: 2, unitPrice: 4500 },
          { sku: "PAD-01", description: "Desk mat", quantity: 1, unitPrice: 2200 },
        ],
      }),
      access: accessRoles,
    });

    r.queryHandler({
      name: "order:payments",
      schema: rowIdSchema,
      handler: async () => ({
        rows: [
          { paidAt: "2026-08-21", amount: 93600, method: "card", status: "settled" },
          { paidAt: "2026-08-25", amount: 31200, method: "invoice", status: "pending" },
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

    r.entity(orderAttachmentEntity);
    r.writeHandler({
      name: "order:attach",
      schema: z.object({ attachment: z.string() }),
      handler: async () => ({ isSuccess: true as const, data: {} }),
      access: accessRoles,
    });

    r.translations({ keys: ORDER_DESK_I18N });

    // `allowEdit: false` drops the automatic Edit row action; attachments are only added and removed.
    r.screen({
      id: "attachment-list",
      type: "entityList",
      entity: "order-attachment",
      columns: ["title"],
      allowEdit: false,
      access: accessRoles,
    });

    r.screen(ordersScreen);
    r.screen(orderRemindScreen);
    r.screen(todayScreen);
    r.screen(orderDetailScreen);
    r.screen(orderFactsScreen);
  });
}
