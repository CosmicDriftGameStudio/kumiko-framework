import { eq } from "drizzle-orm";
import type { DbRunner } from "../db/connection";
import type { StoredEvent } from "../event-store/event-store";
import type { MultiStreamApplyContext } from "../pipeline/multi-stream-apply-context";
import type { MultiStreamApplyFn, ProjectionTable, SingleStreamApplyFn } from "./types/projection";

// Typed-Apply-Helper für r.projection.apply: erlaubt per-event-type
// typed event.payload-Access ohne SingleStreamApplyFn-Generic durch die
// ganze ProjectionDefinition propagieren zu müssen.
//
// Der Helper ist ein purer Type-Vehikel — zur Laufzeit identitäts-fn:
//
//   apply: {
//     "user.created": defineApply<UserCreatedPayload>(async (event, tx) => {
//       // event.payload ist UserCreatedPayload, nicht Record<string, unknown>
//       await tx.insert(usersTable).values({ id: event.aggregateId, ...event.payload });
//     }),
//   }
//
// Default-Generic = Record<string, unknown> behält rückwärtskompatibles
// Verhalten für Apply-Handler die ohne Type-Argument geschrieben sind.
export function defineApply<TPayload = Record<string, unknown>>(
  fn: (event: StoredEvent<TPayload>, tx: DbRunner) => Promise<void>,
): SingleStreamApplyFn {
  return fn as SingleStreamApplyFn;
}

// Pendant für r.multiStreamProjection.apply — bekommt zusätzlich ctx.
export function defineMspApply<TPayload = Record<string, unknown>>(
  fn: (event: StoredEvent<TPayload>, tx: DbRunner, ctx: MultiStreamApplyContext) => Promise<void>,
): MultiStreamApplyFn {
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
    // ProjectionTable erases its column shape on purpose (the framework
    // does not know user table shapes). Drizzle's tx.update().set() is
    // strict about the concrete row, so we feed it the erased value; the
    // type-safety guarantee for `values` lives at the setFields call-site.
    // biome-ignore lint/suspicious/noExplicitAny: see note above.
    const set = values as any;
    await tx
      .update(table)
      .set(set)
      .where(eq(idCol as never, event.aggregateId));
  };
}
