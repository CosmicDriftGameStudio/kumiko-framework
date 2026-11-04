// In-memory order data shared by the real query handlers (feature.ts) and the e2e
// mock dispatcher, so the browser fixture answers exactly what the server would.

import { z } from "zod";

export const ORDER_DETAIL_SCREEN_QN = "order-desk:screen:order-detail";

export const NAMED_FILTER_IDS = ["action-needed", "reminder-due", "ending-soon"] as const;
export type OrderNamedFilterId = (typeof NAMED_FILTER_IDS)[number];

const AGGREGATE_MEASURE_KINDS = ["sum", "avg", "count", "min", "max"] as const;

export const orderListSchema = z.object({
  namedFilter: z.enum(NAMED_FILTER_IDS).optional(),
  search: z.string().optional(),
  sort: z.string().optional(),
  sortDirection: z.enum(["asc", "desc"]).optional(),
  limit: z.number().int().positive().max(200).optional(),
  offset: z.number().int().nonnegative().optional(),
  totalCount: z.boolean().optional(),
  aggregate: z
    .object({
      groupBy: z.string().optional(),
      measures: z
        .array(z.object({ field: z.string(), kind: z.enum(AGGREGATE_MEASURE_KINDS) }))
        .default([]),
    })
    .optional(),
});

export type OrderListPayload = z.infer<typeof orderListSchema>;

// The list sends its narrowing (named filter, search) to the summary query as well; limit and paging never reach it.
export const orderSummarySchema = z.object({
  namedFilter: z.enum(NAMED_FILTER_IDS).optional(),
  search: z.string().optional(),
});

export type OrderSummaryPayload = z.infer<typeof orderSummarySchema>;

type RowTone = "ok" | "warn" | "bad" | "critical" | "neutral";
type UrgencyTone = "negative" | "warn" | "neutral" | "positive";

export type OrderRow = {
  readonly id: string;
  readonly orderNumber: string;
  readonly customerName: string;
  readonly tone: RowTone;
  readonly urgency: number;
  readonly urgencyLabel: string;
  readonly urgencyTone: UrgencyTone;
  readonly nextStep: string;
  readonly nextStepDue: string;
  readonly nextStepReason: string;
  readonly openAmount: number;
  readonly status: "processing" | "shipped" | "closing" | "delivered";
  readonly actionLabel: string;
  readonly canRemind: boolean;
};

const ORDER_ROWS: readonly OrderRow[] = [
  {
    id: "o1",
    orderNumber: "SO-10482",
    customerName: "Aiko Tanaka",
    tone: "bad",
    urgency: 92,
    urgencyLabel: "Critical",
    urgencyTone: "negative",
    nextStep: "Send payment reminder",
    nextStepDue: "by Friday",
    nextStepReason: "312 EUR is 14 days overdue.\nTwo earlier mails stayed unanswered.",
    openAmount: 312,
    status: "processing",
    actionLabel: "Send reminder",
    canRemind: true,
  },
  {
    id: "o2",
    orderNumber: "SO-10483",
    customerName: "Jonas Weber",
    tone: "ok",
    urgency: 0,
    urgencyLabel: "",
    urgencyTone: "neutral",
    nextStep: "",
    nextStepDue: "",
    nextStepReason: "",
    openAmount: 0,
    status: "delivered",
    actionLabel: "",
    canRemind: false,
  },
  {
    id: "o3",
    orderNumber: "SO-10484",
    customerName: "Maria Lopez",
    tone: "warn",
    urgency: 74,
    urgencyLabel: "Overdue",
    urgencyTone: "negative",
    nextStep: "Confirm the delivery slot",
    nextStepDue: "Tuesday",
    nextStepReason: "The carrier asked twice for a date.",
    openAmount: 180,
    status: "shipped",
    actionLabel: "Open order",
    canRemind: false,
  },
  {
    id: "o4",
    orderNumber: "SO-10485",
    customerName: "Tom Becker",
    tone: "warn",
    urgency: 61,
    urgencyLabel: "Urgent",
    urgencyTone: "warn",
    nextStep: "Call about the backorder",
    nextStepDue: "tomorrow",
    nextStepReason: "Two of five items are backordered.\nThe customer expects a full delivery.",
    openAmount: 540,
    status: "processing",
    actionLabel: "Open order",
    canRemind: false,
  },
  {
    id: "o5",
    orderNumber: "SO-10486",
    customerName: "Priya Nair",
    tone: "neutral",
    urgency: 35,
    urgencyLabel: "Due",
    urgencyTone: "neutral",
    nextStep: "Review the credit limit",
    nextStepDue: "next week",
    nextStepReason: "The open balance grew past the agreed limit.",
    openAmount: 1190,
    status: "closing",
    actionLabel: "Open order",
    canRemind: false,
  },
  {
    id: "o6",
    orderNumber: "SO-10487",
    customerName: "Lars Hansen",
    tone: "ok",
    urgency: 0,
    urgencyLabel: "",
    urgencyTone: "neutral",
    nextStep: "",
    nextStepDue: "",
    nextStepReason: "",
    openAmount: 0,
    status: "delivered",
    actionLabel: "",
    canRemind: false,
  },
  {
    id: "o7",
    orderNumber: "SO-10488",
    customerName: "Emma Rossi",
    tone: "bad",
    urgency: 80,
    urgencyLabel: "Overdue",
    urgencyTone: "negative",
    nextStep: "Send payment reminder",
    nextStepDue: "Thursday",
    nextStepReason: "180 EUR is 9 days overdue.",
    openAmount: 180,
    status: "processing",
    actionLabel: "Send reminder",
    canRemind: true,
  },
  {
    id: "o8",
    orderNumber: "SO-10489",
    customerName: "Kenji Mori",
    tone: "ok",
    urgency: 0,
    urgencyLabel: "",
    urgencyTone: "neutral",
    nextStep: "",
    nextStepDue: "",
    nextStepReason: "",
    openAmount: 95,
    status: "closing",
    actionLabel: "",
    canRemind: false,
  },
];

const NAMED_FILTER_PREDICATES: Readonly<Record<OrderNamedFilterId, (row: OrderRow) => boolean>> = {
  "action-needed": (row) => row.nextStep !== "",
  "reminder-due": (row) => row.canRemind && row.nextStepDue === "today",
  "ending-soon": (row) => row.status === "closing",
};

const DEFAULT_PAGE_SIZE = 50;

function matchesSearch(row: OrderRow, search: string | undefined): boolean {
  if (search === undefined || search === "") return true;
  const needle = search.toLowerCase();
  return (
    row.orderNumber.toLowerCase().includes(needle) ||
    row.customerName.toLowerCase().includes(needle)
  );
}

function fieldValue(row: OrderRow, field: string): unknown {
  return Object.entries(row).find(([key]) => key === field)?.[1];
}

function compareRows(
  field: string,
  direction: "asc" | "desc",
): (a: OrderRow, b: OrderRow) => number {
  const sign = direction === "asc" ? 1 : -1;
  return (a, b) => {
    const left = fieldValue(a, field);
    const right = fieldValue(b, field);
    if (typeof left === "number" && typeof right === "number") return sign * (left - right);
    return sign * String(left).localeCompare(String(right));
  };
}

function filteredRows(payload: OrderListPayload): readonly OrderRow[] {
  const predicate =
    payload.namedFilter === undefined ? undefined : NAMED_FILTER_PREDICATES[payload.namedFilter];
  return ORDER_ROWS.filter(
    (row) => (predicate === undefined || predicate(row)) && matchesSearch(row, payload.search),
  );
}

function numericValues(rows: readonly OrderRow[], field: string): number[] {
  return rows.flatMap((row) => {
    const value = fieldValue(row, field);
    return typeof value === "number" ? [value] : [];
  });
}

function measureOf(
  kind: (typeof AGGREGATE_MEASURE_KINDS)[number],
  rows: readonly OrderRow[],
  field: string,
): number | null {
  if (kind === "count") return rows.length;
  const values = numericValues(rows, field);
  if (values.length === 0) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  if (kind === "sum") return sum;
  if (kind === "avg") return sum / values.length;
  return kind === "min" ? Math.min(...values) : Math.max(...values);
}

export type OrderListAnswer =
  | {
      readonly groups: readonly {
        readonly key: null;
        readonly count: number;
        readonly measures: readonly (number | null)[];
      }[];
    }
  | {
      readonly rows: readonly (OrderRow & {
        readonly narrowMeta: string;
        readonly actionScreen?: string;
        readonly actionParams?: { readonly entityId: string };
      })[];
      readonly nextCursor: null;
      readonly total?: number;
    };

export function answerOrderList(payload: OrderListPayload): OrderListAnswer {
  const matching = filteredRows(payload);
  if (payload.aggregate !== undefined) {
    return {
      groups: [
        {
          key: null,
          count: matching.length,
          measures: payload.aggregate.measures.map((m) => measureOf(m.kind, matching, m.field)),
        },
      ],
    };
  }
  const ordered =
    payload.sort === undefined
      ? matching
      : [...matching].sort(compareRows(payload.sort, payload.sortDirection ?? "asc"));
  const offset = payload.offset ?? 0;
  const rows = ordered.slice(offset, offset + (payload.limit ?? DEFAULT_PAGE_SIZE)).map((row) => ({
    ...row,
    narrowMeta: `${euro(row.openAmount)} open · ${row.status}`,
    nextStepShort: row.nextStepDue === "" ? "" : `${row.nextStepDue} · ${euro(row.openAmount)}`,
    ...(row.nextStep !== "" && {
      actionScreen: ORDER_DETAIL_SCREEN_QN,
      actionParams: { entityId: row.id },
    }),
  }));
  return {
    rows,
    nextCursor: null,
    ...(payload.totalCount === true && { total: matching.length }),
  };
}

export function answerOrderSummary(payload: OrderSummaryPayload) {
  const matching = filteredRows(payload);
  const overdue = matching.filter((row) => row.urgencyTone === "negative");
  return {
    items: [
      { label: "Orders", value: matching.length, column: "orderNumber" },
      {
        label: "Open",
        value: euro(matching.reduce((total, row) => total + row.openAmount, 0)),
        column: "openAmount",
      },
      {
        label: "Overdue",
        value: euro(overdue.reduce((total, row) => total + row.openAmount, 0)),
        tone: "bad",
        column: "urgencyLabel",
      },
    ],
  };
}

function actionNeededRows(limit: number): readonly OrderRow[] {
  return ORDER_ROWS.filter(NAMED_FILTER_PREDICATES["action-needed"])
    .sort(compareRows("urgency", "desc"))
    .slice(0, limit);
}

const NOW_LIST_LIMIT = 4;

export function answerNowList() {
  return {
    rows: actionNeededRows(NOW_LIST_LIMIT).map((row) => ({
      ...row,
      nextStepShort: `${row.nextStepDue} · ${euro(row.openAmount)}`,
      actionScreen: ORDER_DETAIL_SCREEN_QN,
      actionParams: { entityId: row.id },
    })),
    total: actionNeededRows(ORDER_ROWS.length).length,
  };
}

export function answerBriefing() {
  const open = actionNeededRows(ORDER_ROWS.length);
  const [first] = open;
  return {
    blocks: [
      {
        kind: "paragraph",
        emphasis: "lead",
        text: `${open.length} orders need you today.${
          first === undefined
            ? ""
            : ` Most pressing is ${first.orderNumber} from ${first.customerName}.`
        }`,
      },
      {
        kind: "hint",
        text: "Sorted by urgency. Open an order and let the assistant prepare the step.",
      },
    ],
    narrowBlocks: [
      { kind: "paragraph", emphasis: "lead", text: `${open.length} orders need you today.` },
      { kind: "hint", text: "Tuesday, 3 November · as of 06:00" },
    ],
  };
}

const DEADLINES = [
  { id: "d1", due: "2026-11-06T09:00:00Z", title: "Reminder SO-10482", orderId: "o1" },
  { id: "d2", due: "2026-11-05T14:00:00Z", title: "Call Tom Becker", orderId: "o4" },
  { id: "d3", due: "2026-11-10T10:30:00Z", title: "Credit review SO-10486", orderId: "o5" },
  { id: "d4", due: "2026-11-12T08:00:00Z", title: "Delivery slot SO-10484", orderId: "o3" },
] as const;

export function answerDeadlines() {
  return {
    rows: [...DEADLINES]
      .sort((a, b) => a.due.localeCompare(b.due))
      .map((deadline) => ({
        id: deadline.id,
        due: deadline.due,
        title: deadline.title,
        screen: ORDER_DETAIL_SCREEN_QN,
        params: { entityId: deadline.orderId },
      })),
  };
}

const CUSTOMERS = [
  {
    id: "c1",
    customerName: "Aiko Tanaka",
    openCount: 3,
    openTone: "negative",
    tone: "bad",
    orderId: "o1",
  },
  {
    id: "c2",
    customerName: "Priya Nair",
    openCount: 2,
    openTone: "warn",
    tone: "warn",
    orderId: "o5",
  },
  {
    id: "c3",
    customerName: "Tom Becker",
    openCount: 1,
    openTone: "neutral",
    tone: "neutral",
    orderId: "o4",
  },
  {
    id: "c4",
    customerName: "Jonas Weber",
    openCount: 0,
    openTone: "positive",
    tone: "ok",
    orderId: "o2",
  },
] as const;

export function answerCustomers() {
  return {
    rows: CUSTOMERS.map((customer) => ({
      id: customer.id,
      customerName: customer.customerName,
      openCount: customer.openCount,
      openTone: customer.openTone,
      tone: customer.tone,
      screen: ORDER_DETAIL_SCREEN_QN,
      params: { entityId: customer.orderId },
    })),
  };
}

function euro(amount: number): string {
  return `€ ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function answerMoney() {
  const open = ORDER_ROWS.reduce((total, row) => total + row.openAmount, 0);
  const overdue = ORDER_ROWS.filter((row) => row.urgencyTone === "negative").reduce(
    (total, row) => total + row.openAmount,
    0,
  );
  return {
    open: euro(open),
    overdue: euro(overdue),
    collected: euro(1860),
    openOrders: String(ORDER_ROWS.filter((row) => row.openAmount > 0).length),
  };
}

export function answerOrderDetail(id: string) {
  return {
    id,
    customerName: "Aiko Tanaka",
    orderNumber: "SO-10482",
    shortTitle: "SO-10482",
    status: "processing",
    totalAmount: "€ 1,248.00",
    totalNote: "2 payments",
    outstandingAmount: "€ 312.00",
    outstandingNote: "14 days overdue",
    outstandingLabel: "Outstanding since 01.12.",
    outstandingTone: "bad",
    itemCount: "3",
    itemsCount: 3,
    paymentsCount: 2,
    placedAt: "2026-08-21",
    shippingAddress: "Karl-Marx-Straße 12, 12043 Berlin",
    billingAddress: "Karl-Marx-Straße 12, 12043 Berlin",
    salesRep: "Jonas Weber",
    path: [{ label: "Orders" }, { label: "Aiko Tanaka" }, { label: "SO-10482" }],
    summaryLine: "Waiting for the second payment",
    summaryShort: "Second payment open.",
    summaryTone: "warn",
    narrowSubtitle: "SO-10482 · placed 21 Aug",
    notice: { title: "Payment overdue", text: "312 EUR is 14 days overdue", tone: "bad" },
    steps: [
      {
        id: "remind",
        title: "Send payment reminder",
        detail: "by Friday",
        narrowDetail: "Fri",
        tone: "warn",
        why: "The invoice is 14 days overdue.\nTwo earlier mails stayed unanswered.\nThe credit limit is 1,500 EUR.",
        canPrepare: true,
      },
      { id: "escalate", title: "Escalate to accounting", canPrepare: false },
      { id: "credit", title: "Review the credit limit", canPrepare: false },
      { id: "handover", title: "Plan the handover", canPrepare: false },
      { id: "close", title: "Close the order", canPrepare: false },
    ],
    progress: [
      {
        title: "Order to cash",
        currentIndex: 1,
        steps: [
          { id: "placed", label: "Placed", done: true, detail: "21 Aug" },
          { id: "paid", label: "Paid", done: false, detail: "312 EUR open" },
          { id: "shipped", label: "Shipped", done: false },
        ],
      },
    ],
  };
}
