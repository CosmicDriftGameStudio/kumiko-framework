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

import { buildDrizzleTable } from "@cosmicdrift/kumiko-framework/db";
import { defineApply } from "@cosmicdrift/kumiko-framework/engine";
import { subscriptionEntity } from "./entities";
import type { SubscriptionEventPayload } from "./events";

// Drizzle-table-instance aus dem entity-shape. Wird sowohl von der
// projection-apply als auch von list-query / get-helper genutzt damit
// alle drei Stellen denselben column-namespace teilen.
export const subscriptionsProjectionTable = buildDrizzleTable("subscription", subscriptionEntity);

// =============================================================================
// Shared helpers
// =============================================================================

/** Felder die alle 5 events vollständig zur Verfügung haben. */
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

/** UPSERT-helper für defensive apply: wenn die row nicht existiert
 *  (= z.B. Plugin sendet "updated" als ersten event eines streams,
 *  oder rebuild-aus-dem-Nichts), legen wir sie an statt fail-silent
 *  zu sein. Apply läuft in der event-TX, expectedVersion macht
 *  drizzle-on-conflict korrekt. */
async function upsert(
  tx: Parameters<Parameters<typeof defineApply<SubscriptionEventPayload>>[0]>[1],
  event: { aggregateId: string; tenantId: string },
  set: Partial<{
    providerName: string;
    providerCustomerId: string;
    providerSubscriptionId: string;
    status: string;
    tier: string;
    currentPeriodEnd: string;
  }>,
  fullPayload: SubscriptionEventPayload,
): Promise<void> {
  // INSERT-fallback braucht ALL fields (NOT NULL constraints). Wenn
  // jemand nur teil-felder updated (z.B. invoice-payment-failed nur
  // status+tier), nutzen wir trotzdem den vollen payload für den
  // INSERT-Pfad und nur den teil-`set` für ON CONFLICT.
  await tx
    .insert(subscriptionsProjectionTable)
    .values({
      id: event.aggregateId,
      tenantId: event.tenantId,
      ...fullSetFromPayload(fullPayload),
    })
    .onConflictDoUpdate({
      target: subscriptionsProjectionTable["id"],
      set,
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
  await upsert(tx, event, full, event.payload);
});

/** subscription-updated → UPSERT mit allen Feldern. */
export const applySubscriptionUpdated = defineApply<SubscriptionEventPayload>(async (event, tx) => {
  const full = fullSetFromPayload(event.payload);
  await upsert(tx, event, full, event.payload);
});

/** subscription-canceled → status/tier/currentPeriodEnd patchen. */
export const applySubscriptionCanceled = defineApply<SubscriptionEventPayload>(
  async (event, tx) => {
    const p = event.payload;
    await upsert(
      tx,
      event,
      { status: p.status, tier: p.tier, currentPeriodEnd: p.currentPeriodEndIso },
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
    { status: p.status, tier: p.tier, currentPeriodEnd: p.currentPeriodEndIso },
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
    await upsert(tx, event, { status: p.status, tier: p.tier }, p);
  },
);
