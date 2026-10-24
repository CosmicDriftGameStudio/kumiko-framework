// Inline projection for `read_subscriptions`. Materializes the 5
// subscription events into one row per tenant.
//
// Apply runs in the same transaction as ctx.events.unsafeAppend, so the caller
// sees its write state immediately (no dispatcher tick required). The PK is
// event.aggregateId (= deterministic uuidv5 per tenant), so replays collide
// on the PK instead of creating duplicate rows.
//
// **Production-deployment caveat:** the generator in
// `samples/apps/platform/drizzle/generate.ts` scans `feature.entities` —
// `subscriptionsProjectionTable` is registered in the projection as a raw
// drizzle-pgTable, NOT as r.entity. Apps mounting subscription-foundation in
// production must add the table to their own `drizzle/generate.ts` (via an
// import of subscriptionsProjectionTable). setupTestStack pushes it
// automatically via r.projection.table.

import {
  buildEntityTable,
  type EntityTableMeta,
  insertOnConflictDoNothing,
  requireEntityTableMeta,
  upsertOnConflict,
} from "@cosmicdrift/kumiko-framework/db";
import { defineApply } from "@cosmicdrift/kumiko-framework/engine";
import { paymentRowId } from "./aggregate-id.ts";
import { paymentEntity, subscriptionEntity } from "./entities.ts";
import type { PaymentEventPayload, SubscriptionEventPayload } from "./events.ts";

// This Drizzle table instance is derived from the entity shape and is shared
// by the projection apply, list query, and get helper so all three use the
// same column namespace.
export const subscriptionsProjectionTable = buildEntityTable("subscription", subscriptionEntity);

// Same production-deployment caveat as subscriptionsProjectionTable above:
// raw drizzle-pgTable, not an r.entity — apps mounting billing-foundation in
// production must add read_payments to their own drizzle/generate.ts too.
export const paymentsProjectionTable = buildEntityTable("payment", paymentEntity);

// Unbranded metas: the apply functions below ARE the executor of these
// projections, so they may write through the typed helpers.
export const subscriptionsProjectionMeta: EntityTableMeta = requireEntityTableMeta(
  subscriptionsProjectionTable,
  "subscription",
);
export const paymentsProjectionMeta: EntityTableMeta = requireEntityTableMeta(
  paymentsProjectionTable,
  "payment",
);

// =============================================================================
// Shared helpers
// =============================================================================

/** Fields every one of the 5 events carries in full. cancelAt stays out:
 *  it is optional (see events.ts) and needs cancelAtSetFromPayload's 3-way
 *  set/null/unchanged split, not this function's unconditional copy. */
function fullSetFromPayload(p: SubscriptionEventPayload) {
  return {
    providerName: p.providerName,
    providerCustomerId: p.providerCustomerId,
    providerSubscriptionId: p.providerSubscriptionId,
    status: p.status,
    tier: p.tier,
    currentPeriodEnd: p.currentPeriodEndIso,
  };
}

/** `cancelAtIso === undefined` (provider doesn't report it, e.g. Mollie) →
 *  leave the column unchanged; otherwise (a value or explicit `null`) set
 *  it. Shared by every apply-function below so the 3-way distinction (set /
 *  clear-to-null / leave-unchanged) lives in exactly one place. */
function cancelAtSetFromPayload(p: SubscriptionEventPayload): {
  readonly cancelAt?: string | null;
} {
  return p.cancelAtIso !== undefined ? { cancelAt: p.cancelAtIso } : {};
}

/** UPSERT helper for defensive applies: if the row does not exist yet
 *  (a plugin sends "updated" as a stream's first event, or a rebuild
 *  starts from nothing), create it instead of failing silently. Apply
 *  runs in the event TX, so expectedVersion keeps on-conflict correct.
 *
 *  `modified_at` is always stamped from `event.createdAt` (never `now()`),
 *  on every apply including the initial create — a projection rebuild at a
 *  different wall-clock time must materialize the exact same row, and
 *  `getSubscriptionForTenant`'s `lastChangedAt` (staleness check for
 *  incomplete subscriptions) depends on that determinism. */
async function upsert(
  tx: Parameters<Parameters<typeof defineApply<SubscriptionEventPayload>>[0]>[1],
  event: { aggregateId: string; tenantId: string; createdAt: Temporal.Instant },
  set: Partial<{
    providerName: string;
    providerCustomerId: string;
    providerSubscriptionId: string;
    status: string;
    tier: string;
    currentPeriodEnd: string;
    cancelAt: string | null;
  }>,
  fullPayload: SubscriptionEventPayload,
): Promise<void> {
  // The INSERT fallback requires ALL fields because of NOT NULL constraints.
  // If an update changes only some fields (for example, invoice-payment-failed
  // changes only status+tier), the full payload is still used for the INSERT
  // path, while only the partial `set` is used for ON CONFLICT.
  const insertCols = {
    id: event.aggregateId,
    tenantId: event.tenantId,
    providerName: fullPayload.providerName,
    providerCustomerId: fullPayload.providerCustomerId,
    providerSubscriptionId: fullPayload.providerSubscriptionId,
    status: fullPayload.status,
    tier: fullPayload.tier,
    currentPeriodEnd: fullPayload.currentPeriodEndIso,
    cancelAt: fullPayload.cancelAtIso ?? null,
    modifiedAt: event.createdAt,
  };
  const definedSet = Object.fromEntries(Object.entries(set).filter(([, v]) => v !== undefined));
  await upsertOnConflict(tx, subscriptionsProjectionMeta, insertCols, {
    conflictKeys: ["id"],
    update: { modifiedAt: event.createdAt, ...definedSet },
  });
}

// =============================================================================
// Apply functions — one per event type
//
// All use UPSERT for defensive consistency: an out-of-order event (for
// example, during a rebuild-from-events) can arrive in any order and still
// materialize the row correctly.
// =============================================================================

/** subscription-created → UPSERT with all fields. PK = aggregateId =
 *  subscriptionAggregateId(tenantId), with one row per tenant. UPSERT allows
 *  the Disney+-change pattern (a second provider sends create for the same
 *  tenant) to overwrite the existing row instead of causing a PK conflict. */
export const applySubscriptionCreated = defineApply<SubscriptionEventPayload>(async (event, tx) => {
  const full = fullSetFromPayload(event.payload);
  await upsert(tx, event, { ...full, ...cancelAtSetFromPayload(event.payload) }, event.payload);
});

/** subscription-updated → UPSERT with all fields. */
export const applySubscriptionUpdated = defineApply<SubscriptionEventPayload>(async (event, tx) => {
  const full = fullSetFromPayload(event.payload);
  await upsert(tx, event, { ...full, ...cancelAtSetFromPayload(event.payload) }, event.payload);
});

/** subscription-canceled → status/tier/currentPeriodEnd patchen. */
export const applySubscriptionCanceled = defineApply<SubscriptionEventPayload>(
  async (event, tx) => {
    const p = event.payload;
    await upsert(
      tx,
      event,
      {
        status: p.status,
        tier: p.tier,
        currentPeriodEnd: p.currentPeriodEndIso,
        ...cancelAtSetFromPayload(p),
      },
      p,
    );
  },
);

/** invoice-paid → state update (status, tier, currentPeriodEnd).
 *  The invoice history itself lives in the event store, so it remains
 *  replayable. */
export const applyInvoicePaid = defineApply<SubscriptionEventPayload>(async (event, tx) => {
  const p = event.payload;
  await upsert(
    tx,
    event,
    {
      status: p.status,
      tier: p.tier,
      currentPeriodEnd: p.currentPeriodEndIso,
      ...cancelAtSetFromPayload(p),
    },
    p,
  );
});

/** invoice-payment-failed → status (typically past_due) + tier. The tier
 *  engine reads the row and decides whether to downgrade. currentPeriodEnd is
 *  intentionally unchanged: the period has not "ended"; payment simply
 *  failed. */
export const applyInvoicePaymentFailed = defineApply<SubscriptionEventPayload>(
  async (event, tx) => {
    const p = event.payload;
    await upsert(tx, event, { status: p.status, tier: p.tier, ...cancelAtSetFromPayload(p) }, p);
  },
);

// =============================================================================
// payment-received apply — one row per event, no UPSERT
// =============================================================================

/** payment-received → INSERT-once row keyed by a deterministic uuid derived
 *  from (tenantId, providerName, providerEventId) — NOT `event.id`, which is
 *  the event-store's global bigserial sequence (not a UUID, can't back this
 *  uuid-typed PK) — and not aggregateId, which is shared by every payment on
 *  the same tenant's payment-stream. tenantId is part of the key because the
 *  idempotency scan is per-tenant: without it, two tenants sharing the same
 *  providerEventId would collide on ON CONFLICT DO NOTHING and silently lose
 *  the second tenant's row. ON CONFLICT DO NOTHING also makes a projection
 *  rebuild idempotent without mutating an existing row. */
export const applyPaymentReceived = defineApply<PaymentEventPayload>(async (event, tx) => {
  const providerEventId = event.metadata.headers?.["providerEventId"];
  const providerName = event.metadata.headers?.["providerName"];
  if (typeof providerEventId !== "string" || typeof providerName !== "string") {
    throw new Error(
      "applyPaymentReceived: event.metadata.headers is missing providerEventId/providerName — process-payment-event.write.ts always sets both",
    );
  }
  await insertOnConflictDoNothing(tx, paymentsProjectionMeta, {
    id: paymentRowId(event.tenantId, providerName, providerEventId),
    tenantId: event.tenantId,
    providerName: event.payload.providerName,
    providerCustomerId: event.payload.providerCustomerId,
    priceId: event.payload.priceId,
  });
});
