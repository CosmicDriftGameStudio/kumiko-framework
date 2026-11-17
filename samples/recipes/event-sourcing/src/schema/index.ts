import {
  buildEntityTable,
  createEventStoreExecutor,
  integer,
  table,
  text,
  uuid,
} from "@cosmicdrift/kumiko-framework/db";
import { createEntity, createTextField } from "@cosmicdrift/kumiko-framework/engine";


export type InvoiceState = {
  id: string | null;
  customer: string | null;
  status: string;
  amountCents: number;
  approvedBy: string | null;
  paid: boolean;
};

// Record<string,unknown>-compatible alias — the snapshot reducer generic
// constrains state to that shape, so we hand it this view instead of the
// narrower InvoiceState to satisfy the bound without changing semantics.
export type InvoiceStateRecord = Record<string, unknown> & InvoiceState;

export const initialInvoiceState: InvoiceState = {
  id: null,
  customer: null,
  status: "missing",
  amountCents: 0,
  approvedBy: null,
  paid: false,
};

export function reduceInvoice(state: InvoiceState, evt: { type: string; payload: unknown }): void {
  if (evt.type === "showcase-invoice.created") {
    const p = evt.payload as { id: string; customer: string; status: string };
    state.id = p.id;
    state.customer = p.customer;
    state.status = p.status;
  } else if (evt.type.endsWith(":event:invoice-approved")) {
    const p = evt.payload as { amountCents: number; approvedBy: string };
    state.status = "approved";
    state.amountCents = p.amountCents;
    state.approvedBy = p.approvedBy;
  } else if (evt.type.endsWith(":event:invoice-paid")) {
    state.status = "paid";
    state.paid = true;
  }
}

// --- Aggregate entity: invoice, stored as events only ---

export const invoiceEntity = createEntity({
  name: "showcase-invoice",
  table: "read_showcase_invoices",
  fields: {
    customer: createTextField({ personal: { of: "id" }, find: "none", required: true }),
    status: createTextField({ personal: false, reason: "is_business_data", required: true }), // "draft" | "approved" | "paid" | "closed"
  },
});

export const invoiceTable = buildEntityTable(invoiceEntity);

// --- Projection 1: per-invoice detail (single-stream, inline) ---

export const invoiceDetailTable = table("read_showcase_invoice_detail", {
  invoiceId: uuid("invoice_id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  customer: text("customer").notNull(),
  status: text("status").notNull(),
  amountCents: integer("amount_cents").notNull().default(0),
});

// --- Projection 2: per-customer revenue (multi-stream, async) ---

export const customerRevenueTable = table("read_showcase_customer_revenue", {
  customer: text("customer").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  paidInvoices: integer("paid_invoices").notNull().default(0),
  totalCents: integer("total_cents").notNull().default(0),
});

// --- Reference data: approver display-name directory ---
// The async upcaster (invoice-acknowledged v1 → v2) reads from this table
// to enrich legacy events with a human-readable name. In production this
// would be a domain-owned read model; here it's a flat lookup table.
export const approverDirectoryTable = table("read_showcase_approver_directory", {
  approverId: text("approver_id").primaryKey(),
  displayName: text("display_name").notNull(),
});

export const invoiceExecutor = createEventStoreExecutor(invoiceTable, invoiceEntity, {
  entityName: "showcase-invoice",
});
