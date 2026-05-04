// Inline-projection für `read_subscriptions`. Materialisiert die 5
// subscription-events in eine row pro Tenant.
//
// Apply läuft in derselben TX wie ctx.appendEventUnsafe — Caller sieht
// seinen Schreib-State sofort (kein dispatcher-tick nötig). PK = event.
// aggregateId (= deterministic uuidv5 pro Tenant) → replays kollidieren
// auf der PK statt doppelte rows zu erzeugen.

import { buildDrizzleTable } from "@kumiko/framework/db";
import { defineApply } from "@kumiko/framework/engine";
import { eq } from "drizzle-orm";
import { subscriptionEntity } from "./entities";
import type { SubscriptionEventPayload } from "./events";

// Drizzle-table-instance aus dem entity-shape. Wird sowohl von der
// projection-apply als auch von list-query / get-helper genutzt damit
// alle drei Stellen denselben column-namespace teilen.
export const subscriptionsProjectionTable = buildDrizzleTable("subscription", subscriptionEntity);

// =============================================================================
// Apply-functions — eine pro event-typ
// =============================================================================

/** subscription-created → UPSERT (= INSERT ... ON CONFLICT DO UPDATE).
 *  PK = aggregateId = subscriptionAggregateId(tenantId), one row pro
 *  Tenant. UPSERT statt plain INSERT damit der Disney+-Wechsel-Pattern
 *  (= zweiter Provider sendet create für selben Tenant) den existing
 *  row überschreibt statt PK-conflict. */
export const applySubscriptionCreated = defineApply<SubscriptionEventPayload>(async (event, tx) => {
  const payload = event.payload;
  const values = {
    id: event.aggregateId,
    tenantId: event.tenantId,
    providerName: payload.providerName,
    providerCustomerId: payload.providerCustomerId,
    providerSubscriptionId: payload.providerSubscriptionId,
    status: payload.status,
    tier: payload.tier,
    currentPeriodEnd: payload.currentPeriodEndIso,
  };
  await tx
    .insert(subscriptionsProjectionTable)
    .values(values)
    .onConflictDoUpdate({
      target: subscriptionsProjectionTable["id"],
      set: {
        providerName: values.providerName,
        providerCustomerId: values.providerCustomerId,
        providerSubscriptionId: values.providerSubscriptionId,
        status: values.status,
        tier: values.tier,
        currentPeriodEnd: values.currentPeriodEnd,
      },
    });
});

/** subscription-updated → UPDATE. Provider-Wechsel oder tier-Änderung
 *  innerhalb derselben Subscription. */
export const applySubscriptionUpdated = defineApply<SubscriptionEventPayload>(async (event, tx) => {
  const payload = event.payload;
  await tx
    .update(subscriptionsProjectionTable)
    .set({
      providerName: payload.providerName,
      providerCustomerId: payload.providerCustomerId,
      providerSubscriptionId: payload.providerSubscriptionId,
      status: payload.status,
      tier: payload.tier,
      currentPeriodEnd: payload.currentPeriodEndIso,
    })
    .where(eq(subscriptionsProjectionTable["id"], event.aggregateId));
});

/** subscription-canceled → status auf canceled, tier bleibt. Read-side
 *  filtert auf status=active wenn nur live-subs interessieren. */
export const applySubscriptionCanceled = defineApply<SubscriptionEventPayload>(
  async (event, tx) => {
    const payload = event.payload;
    await tx
      .update(subscriptionsProjectionTable)
      .set({
        status: payload.status,
        tier: payload.tier,
        currentPeriodEnd: payload.currentPeriodEndIso,
      })
      .where(eq(subscriptionsProjectionTable["id"], event.aggregateId));
  },
);

/** invoice-paid → state-update (status, currentPeriodEnd). Invoice-
 *  history selbst lebt im event-store (= Replay-fähig). */
export const applyInvoicePaid = defineApply<SubscriptionEventPayload>(async (event, tx) => {
  const payload = event.payload;
  await tx
    .update(subscriptionsProjectionTable)
    .set({
      status: payload.status,
      tier: payload.tier,
      currentPeriodEnd: payload.currentPeriodEndIso,
    })
    .where(eq(subscriptionsProjectionTable["id"], event.aggregateId));
});

/** invoice-payment-failed → status (typisch past_due). Tier-engine
 *  liest die row + entscheidet ob downgrade. */
export const applyInvoicePaymentFailed = defineApply<SubscriptionEventPayload>(
  async (event, tx) => {
    const payload = event.payload;
    await tx
      .update(subscriptionsProjectionTable)
      .set({
        status: payload.status,
        tier: payload.tier,
      })
      .where(eq(subscriptionsProjectionTable["id"], event.aggregateId));
  },
);
