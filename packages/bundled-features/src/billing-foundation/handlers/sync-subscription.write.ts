// sync-subscription — backfill handler for the `sync-subscriptions` job
// (registered in feature.ts). Pulls the live provider-side state of the
// tenant's subscription and appends it as a `subscription.updated` (or
// `subscription.canceled`, when the snapshot's own status is terminal)
// event when it has drifted from `read_subscriptions` — catches
// provider-side changes (e.g. a `cancel_at` set on the provider's own
// dashboard, or a cancellation) that never reached us as a webhook.
//
// SYSTEM_ROLE, not just "SystemAdmin": the `sync-subscriptions` job's own
// systemUser only carries `roles: ["system"]` (createSystemUser(tenantId),
// no extra roles — see job-runner.ts), unlike the webhook path's
// dispatchSystemWrite which adds "SystemAdmin". Same access shape as
// tenant/handlers/memberships.query.ts and active-tenant-ids.query.ts for
// the same reason. A human SystemAdmin can still dispatch this directly.

import { createHash } from "node:crypto";
import { SYSTEM_ROLE, type WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
// Aliased — an un-aliased `Temporal` would shadow the ambient global
// `Temporal` TYPE `SubscriptionView.currentPeriodEnd`/`.cancelAt` resolve
// against, same reasoning as constants.ts's own import.
import { Temporal as TemporalPolyfill } from "temporal-polyfill";
import * as z from "zod";
import { findProviderPlugin } from "../checkout-core";
import { isTerminalSubscriptionStatus, SubscriptionEventTypes } from "../constants";
import { getSubscriptionForTenant } from "../get-subscription-for-tenant";
import { appendSubscriptionEvent } from "./process-event.write";

export const syncSubscriptionSchema = z.object({}).strict();

export type SyncSubscriptionSkipReason =
  | "no_live_subscription"
  | "provider_cannot_retrieve"
  | "not_found"
  | "unchanged";

export type SyncSubscriptionResult =
  | { readonly synced: true }
  | { readonly synced: false; readonly reason: SyncSubscriptionSkipReason };

// Parses both sides fresh via the polyfill before comparing — tolerant of a
// provider snapshot's ISO string using a different (but equivalent)
// representation than `Temporal.Instant#toString()`'s canonical form
// (offset spelling, sub-second precision, ...), unlike a plain `===` on the
// raw strings.
function isoInstantsEqual(a: string, b: string): boolean {
  return (
    TemporalPolyfill.Instant.compare(
      TemporalPolyfill.Instant.from(a),
      TemporalPolyfill.Instant.from(b),
    ) === 0
  );
}

// Deterministic per (snapshot-content, current stream head) — not per-call.
// Folding in `lastChangedAt` (not just the snapshot's own fields) closes a
// gap a content-only hash has: dashboard-cancel → sync(A) → dashboard-
// reactivate → sync(B) → dashboard-cancel-again → sync would hash back to
// A's already-seen providerEventId and get silently treated as a duplicate,
// leaving the row stuck on B even though the provider is on A again.
// `lastChangedAt` advances on every applied event, so the third sync's hash
// differs from the first's even though the snapshot content matches.
function syncProviderEventId(
  snapshot: {
    readonly providerSubscriptionId: string;
    readonly status: string;
    readonly tier: string;
    readonly currentPeriodEnd: string;
    readonly cancelAt: string | null;
  },
  lastChangedAt: string,
): string {
  const hashInput = [
    snapshot.providerSubscriptionId,
    snapshot.status,
    snapshot.tier,
    snapshot.currentPeriodEnd,
    snapshot.cancelAt ?? "",
    lastChangedAt,
  ].join("|");
  return `sync:${createHash("sha256").update(hashInput).digest("hex")}`;
}

export const syncSubscriptionHandler: WriteHandlerDef = {
  name: "sync-subscription",
  agent: { expose: false },
  schema: syncSubscriptionSchema,
  access: { roles: [SYSTEM_ROLE, "SystemAdmin"] },
  handler: async (event, ctx) => {
    const tenantId = event.user.tenantId;
    const sub = await getSubscriptionForTenant(ctx, tenantId);
    if (!sub || isTerminalSubscriptionStatus(sub.status)) {
      return {
        isSuccess: true as const,
        data: { synced: false, reason: "no_live_subscription" } satisfies SyncSubscriptionResult,
      };
    }

    // Non-throwing — a provider deregistered since the subscription was
    // created is the same "can't reconcile right now" outcome as a plugin
    // that never implemented retrieveSubscription, not a hard failure.
    const found = findProviderPlugin(ctx, sub.providerName);
    if (!found?.plugin.retrieveSubscription) {
      return {
        isSuccess: true as const,
        data: {
          synced: false,
          reason: "provider_cannot_retrieve",
        } satisfies SyncSubscriptionResult,
      };
    }

    const snapshot = await found.plugin.retrieveSubscription(ctx, sub.providerSubscriptionId);
    if (!snapshot) {
      return {
        isSuccess: true as const,
        data: { synced: false, reason: "not_found" } satisfies SyncSubscriptionResult,
      };
    }

    const cancelAtUnchanged =
      snapshot.cancelAt === null
        ? sub.cancelAt === null
        : sub.cancelAt !== null && isoInstantsEqual(snapshot.cancelAt, sub.cancelAt.toString());
    const unchanged =
      snapshot.status === sub.status &&
      snapshot.tier === sub.tier &&
      isoInstantsEqual(snapshot.currentPeriodEnd, sub.currentPeriodEnd.toString()) &&
      cancelAtUnchanged;
    if (unchanged) {
      return {
        isSuccess: true as const,
        data: { synced: false, reason: "unchanged" } satisfies SyncSubscriptionResult,
      };
    }

    const appendResult = await appendSubscriptionEvent(ctx, tenantId, {
      providerEventId: syncProviderEventId(snapshot, sub.lastChangedAt.toString()),
      providerName: sub.providerName,
      // A snapshot that already landed on a terminal status (canceled on the
      // provider's own dashboard, never arrived as a webhook) must append as
      // a real `canceled` event, not `updated` — anything downstream that
      // reads the event-log's own type (not just the projection's status
      // column, which both apply-functions patch the same way) needs the
      // accurate event-type to react to a cancellation.
      type: isTerminalSubscriptionStatus(snapshot.status)
        ? SubscriptionEventTypes.canceled
        : SubscriptionEventTypes.updated,
      providerCustomerId: snapshot.providerCustomerId,
      providerSubscriptionId: snapshot.providerSubscriptionId,
      status: snapshot.status,
      tier: snapshot.tier,
      currentPeriodEndIso: snapshot.currentPeriodEnd,
      cancelAtIso: snapshot.cancelAt,
      rawPayload: snapshot.rawPayload,
    });

    return {
      isSuccess: true as const,
      data: (appendResult.duplicate
        ? { synced: false, reason: "unchanged" }
        : { synced: true }) satisfies SyncSubscriptionResult,
    };
  },
};
