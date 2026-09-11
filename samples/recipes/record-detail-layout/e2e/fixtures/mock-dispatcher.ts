// In-memory dispatcher for record-detail-layout/e2e (fw#2778). Same shape as
// writeform-section/e2e/fixtures/mock-dispatcher.ts — implements only the
// three query QNs order-desk's projectionDetail screen needs:
//
//   - "order-desk:query:order:detail" — the screen's own header/metrics row.
//   - "order-desk:query:order:items"  — the "items" relatedList tab.
//   - "order-desk:query:order:payments" — the "payments" relatedList tab.
//
// The "items" row count is driven by the page's own `?items=<n>` URL param
// (read at query time, not baked into the fixture) so the same server can
// back both the short-list and long-list layout measurements the
// fw#2778 fix needs — a fixed row count would need two fixtures.

import type {
  BatchResult,
  Command,
  Dispatcher,
  DispatcherStatus,
  PendingFile,
  PendingWrite,
  QueryOpts,
  QueryResult,
  Store,
  WriteOpts,
  WriteResult,
} from "@cosmicdrift/kumiko-headless";

const QUERY_ORDER_DETAIL = "order-desk:query:order:detail";
const QUERY_ORDER_ITEMS = "order-desk:query:order:items";
const QUERY_ORDER_PAYMENTS = "order-desk:query:order:payments";

const ORDER_DETAIL_FIELDS = {
  customerName: "Aiko Tanaka",
  orderNumber: "SO-10482",
  status: "processing",
  totalAmount: "€ 1,248.00",
  outstandingAmount: "€ 312.00",
  itemCount: "3",
  placedAt: "2026-08-21",
};

function itemsCountFromUrl(): number {
  const raw = new URLSearchParams(window.location.search).get("items");
  const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}

function buildItemRows(count: number): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, i) => ({
    sku: `KB-${100 + i}`,
    description: `Item ${i + 1}`,
    quantity: 1,
    unitPrice: 10 + i,
  }));
}

const ONLINE_STORE: Store<DispatcherStatus> = {
  getSnapshot: () => "online",
  subscribe: () => () => {},
};

export function createMockDispatcher(): Dispatcher {
  async function write<TData = unknown>(type: string): Promise<WriteResult<TData>> {
    throw new Error(`mock-dispatcher: unsupported write qn "${type}"`);
  }

  async function query<TData = unknown>(
    type: string,
    payload: unknown,
    _opts?: QueryOpts,
  ): Promise<QueryResult<TData>> {
    if (type === QUERY_ORDER_DETAIL) {
      const data = (payload ?? {}) as Record<string, unknown>; // @cast-boundary mock-dispatcher wire payload
      const id = (data["id"] as string | undefined) ?? "order-1";
      return { isSuccess: true, data: { id, ...ORDER_DETAIL_FIELDS } as unknown as TData };
    }
    if (type === QUERY_ORDER_ITEMS) {
      return { isSuccess: true, data: { rows: buildItemRows(itemsCountFromUrl()) } as TData };
    }
    if (type === QUERY_ORDER_PAYMENTS) {
      return {
        isSuccess: true,
        data: {
          rows: [
            { paidAt: "2026-08-21", amount: 936, method: "card", status: "settled" },
            { paidAt: "2026-08-25", amount: 312, method: "invoice", status: "pending" },
          ],
        } as TData,
      };
    }
    throw new Error(`mock-dispatcher: unsupported query qn "${type}"`);
  }

  async function batch(commands: readonly Command[], opts?: WriteOpts): Promise<BatchResult> {
    const results: WriteResult[] = [];
    for (const cmd of commands) results.push(await write(cmd.type, cmd.payload, opts));
    return { isSuccess: true, results };
  }

  return {
    write,
    query,
    batch,
    statusStore: ONLINE_STORE,
    async *stream() {},
    pendingWrites: (): readonly PendingWrite[] => [],
    pendingFiles: (): readonly PendingFile[] => [],
  };
}
