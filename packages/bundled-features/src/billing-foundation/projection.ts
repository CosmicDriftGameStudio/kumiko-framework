// Inline-projection für `read_subscriptions`. Materialisiert die 5
// subscription-events in eine row pro Tenant.
//
// Apply läuft in derselben TX wie ctx.unsafeAppendEvent — Caller sieht
// seinen Schreib-State sofort (kein dispatcher-tick nötig). PK = event.
// aggregateId (= deterministic uuidv5 pro Tenant) → replays kollidieren
// auf der PK statt doppelte rows zu erzeugen.
//
// **Production-deployment caveat:** der Generator in
// `samples/apps/platform/drizzle/generate.ts` scant `feature.entities` —
// `subscriptionsProjectionTable` ist als raw drizzle-pgTable in der
// projection registriert, NICHT als r.entity. Apps die subscription-
// foundation production mounten müssen die Tabelle in ihre eigene
// `drizzle/generate.ts` ergänzen (= via subscriptionsProjectionTable-
// import). setupTestStack pusht sie automatisch via r.projection.table.

import {
  insertOnConflictDoNothing,
  requireEntityTableMeta,
  upsertOnConflict,
} from "@cosmicdrift/kumiko-framework/bun-db";
import { buildEntityTable, type EntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import { defineApply } from "@cosmicdrift/kumiko-framework/engine";
import { paymentRowId } from "./aggregate-id.js";
import { paymentEntity, subscriptionEntity } from "./entities.js";
import type { PaymentEventPayload, SubscriptionEventPayload } from "./events.js";

// Drizzle-table-instance aus dem entity-shape. Wird sowohl von der
// projection-apply als auch von list-query / get-helper genutzt damit
// alle drei Stellen denselben column-namespace teilen.
export const subscriptionsProjectionTable = buildEntityTable("subscription", subscriptionEntity);

// Same production-deployment caveat as subscriptionsProjectionTable above:
// raw drizzle-pgTable, not an r.entity — apps mounting billing-foundation in
// production must add read_payments to their own drizzle/generate.ts too.
export const paymentsProjectionTable = buildEntityTable("payment", paymentEntity);

// Unbranded metas: the apply functions below ARE the executor of these
// projections, so they may write through the typed helpers.
const subscriptionsProjectionMeta: EntityTableMeta = requireEntityTableMeta(
  subscriptionsProjectionTable,
  "subscription",
);
const paymentsProjectionMeta: EntityTableMeta = requireEntityTableMeta(
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
  // INSERT-fallback braucht ALL fields (NOT NULL constraints). Wenn
  // jemand nur teil-felder updated (z.B. invoice-payment-failed nur
  // status+tier), nutzen wir trotzdem den vollen payload für den
  // INSERT-Pfad und nur den teil-`set` für ON CONFLICT.
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
// Apply-functions — eine pro event-typ
//
// Alle UPSERT für defensive consistency: ein out-of-order event
// (z.B. rebuild-from-events) kann in jeder Reihenfolge ankommen
// und die row korrekt materialisieren.
// =============================================================================

/** subscription-created → UPSERT mit allen Feldern. PK = aggregateId =
 *  subscriptionAggregateId(tenantId), one row pro Tenant. UPSERT damit
 *  Disney+-Wechsel-Pattern (= zweiter Provider sendet create für selben
 *  Tenant) den existing row überschreibt statt PK-conflict. */
export const applySubscriptionCreated = defineApply<SubscriptionEventPayload>(async (event, tx) => {
  const full = fullSetFromPayload(event.payload);
  await upsert(tx, event, { ...full, ...cancelAtSetFromPayload(event.payload) }, event.payload);
});

/** subscription-updated → UPSERT mit allen Feldern. */
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

/** invoice-paid → state-update (status, tier, currentPeriodEnd).
 *  Invoice-history selbst lebt im event-store (= Replay-fähig). */
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

/** invoice-payment-failed → status (typisch past_due) + tier. tier-
 *  engine liest die row + entscheidet ob downgrade. currentPeriodEnd
 *  bewusst nicht — die Period ist noch nicht "vorbei", payment hat
 *  nur nicht geklappt. */
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
