import type { ExecutorManagedRunner } from "@cosmicdrift/kumiko-types/executor-brand";
import { updateMany } from "../db/query.ts";
import { extractTableInfo } from "../db/table-info.ts";
import type { StoredEvent } from "../event-store/event-store.ts";
import type { MultiStreamApplyContext } from "../pipeline/multi-stream-apply-context.ts";
import type {
  MultiStreamApplyFn,
  ProjectionTable,
  SingleStreamApplyFn,
} from "./types/projection.ts";

type ProjectionEvent = Parameters<SingleStreamApplyFn>[0];

// Only columns the table declares: a projection table is free to omit the entity system columns.
function presentColumns(
  table: ProjectionTable,
  columns: Record<string, unknown>,
): Record<string, unknown> {
  const info = extractTableInfo(table);
  return Object.fromEntries(Object.entries(columns).filter(([field]) => info.hasColumn(field)));
}

// From the event, not now(): a rebuild must write the same values as the live apply.
export function projectionInsertColumns(
  table: ProjectionTable,
  event: ProjectionEvent,
): Record<string, unknown> {
  return presentColumns(table, {
    tenantId: event.tenantId,
    insertedAt: event.createdAt,
    insertedById: event.createdBy,
  });
}

export function projectionUpdateColumns(
  table: ProjectionTable,
  event: ProjectionEvent,
): Record<string, unknown> {
  return presentColumns(table, { modifiedAt: event.createdAt, modifiedById: event.createdBy });
}

// Typed apply helper for r.projection.apply: enables typed event.payload
// access per event type without propagating a SingleStreamApplyFn generic
// through the entire ProjectionDefinition.
//
// The helper is purely a type vehicle — an identity function at runtime:
//
//   apply: {
//     "user.created": defineApply<UserCreatedPayload>(async (event, tx, table) => {
//       // event.payload is UserCreatedPayload, not Record<string, unknown>.
//       // Write through the passed `table` (ES-blessed inside apply), not a
//       // closed-over branded constant.
//       await insertOne(tx, table, { id: event.aggregateId, ...event.payload });
//     }),
//   }
//
// The default generic, Record<string, unknown>, preserves backward-compatible
// behavior for apply handlers written without a type argument. The `table`
// parameter is optional to use, so 2-argument applies remain valid.
export function defineApply<TPayload = Record<string, unknown>>(
  fn: (
    event: StoredEvent<TPayload>,
    tx: ExecutorManagedRunner,
    table: ProjectionTable,
  ) => Promise<void>,
): SingleStreamApplyFn {
  // @cast-boundary engine-bridge — typed user-fn → erased internal storage
  return fn as SingleStreamApplyFn;
}

// Counterpart for r.multiStreamProjection.apply — also receives ctx.
export function defineMspApply<TPayload = Record<string, unknown>>(
  fn: (
    event: StoredEvent<TPayload>,
    tx: ExecutorManagedRunner,
    ctx: MultiStreamApplyContext,
  ) => Promise<void>,
): MultiStreamApplyFn {
  // @cast-boundary engine-bridge — typed user-fn → erased internal storage
  return fn as MultiStreamApplyFn;
}

// UPDATE <projection-table> SET <fields> WHERE id = event.aggregateId.
// The "event drives one row by aggregate id" shape is what 90 % of state-
// machine projections look like: every status-change event maps to a single
// column update on the projection's own row. Pass a literal object for
// fixed values, or a reducer-style function when the new value comes from
// the event payload.
//
//   r.projection({
//     name: "invoice-status",
//     source: "invoice",
//     table: invoiceTable,
//     apply: {
//       [INVOICE.sent]: setFields(invoiceTable, { status: "sent" }),
//       [INVOICE.statusForced]: setFields(invoiceTable, (e) => {
//         const p = e.payload as { newStatus: InvoiceStatus };
//         return { status: p.newStatus };
//       }),
//     },
//   });
//
// The projection table must expose an `id` column typed as the aggregate's
// stream id — every executor-managed aggregate table does. Use a raw apply
// function when the update targets a different key or needs JOIN/SET logic.
//
// Stamps modifiedAt and modifiedById from the event when the table has those columns; values
// passed by the caller win. Row version: applyStreamVersionToEntityRow.
export function setFields(
  table: ProjectionTable,
  fields:
    | Record<string, unknown>
    | ((event: Parameters<SingleStreamApplyFn>[0]) => Record<string, unknown>),
): SingleStreamApplyFn {
  const idCol = (table as Record<string, unknown>)["id"]; // @cast-boundary dynamic-key
  if (!idCol) {
    throw new Error(
      "setFields: projection table has no 'id' column — pass a custom apply function for tables keyed on another column.",
    );
  }
  return async (event, tx) => {
    const values = typeof fields === "function" ? fields(event) : fields;
    await updateMany(
      tx,
      table,
      { ...projectionUpdateColumns(table, event), ...values },
      { id: event.aggregateId },
    );
  };
}
