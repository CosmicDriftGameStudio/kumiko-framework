// sync-subscription — backfill handler for the `sync-subscriptions` job
// (registered in feature.ts). Pulls the live provider-side state of the
// tenant's subscription and appends it as a `subscription.updated` (or
// `subscription.canceled`, when the snapshot's own status is terminal)
// event when it has drifted from `read_subscriptions` — catches
// provider-side changes (e.g. a `cancel_at` set on the provider's own
// dashboard, or a cancellation) that never reached us as a webhook.
// The provider call runs outside any transaction (perCommand); the append happens in
// apply-subscription-snapshot under the stream lock.
//
// SYSTEM_ROLE, not just "SystemAdmin": the `sync-subscriptions` job's own
// systemUser only carries `roles: ["system"]` (createSystemUser(tenantId),
// no extra roles — see job-runner.ts), unlike the webhook path's
// dispatchSystemWrite which adds "SystemAdmin". Same access shape as
// tenant/handlers/memberships.query.ts and active-tenant-ids.query.ts for
// the same reason. A human SystemAdmin can still dispatch this directly.

import { defineWriteHandler, SYSTEM_ROLE } from "@cosmicdrift/kumiko-framework/engine";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { findProviderPlugin } from "../checkout-core.ts";
import { getSubscriptionForTenant } from "../get-subscription-for-tenant.ts";
import { isTerminalSubscriptionStatus, SubscriptionFoundationHandlers } from "../web/constants.ts";
import type { SyncSubscriptionResult } from "./apply-subscription-snapshot.write.ts";

export const syncSubscriptionSchema = z.object({}).strict();

// The retrieval time stands in for the provider's event time, so a webhook emitted before
// this snapshot cannot roll the synced state back later. Provider webhook times are
// whole-second and come from the provider's clock, so the stamp is floored and shifted back:
// a genuine webhook right after the sync must not look older than the snapshot.
const SYNC_SNAPSHOT_EVENT_TIME_MARGIN_SECONDS = 5;

function snapshotEventTime(): Temporal.Instant {
  return Temporal.Now.instant()
    .round({ smallestUnit: "second", roundingMode: "floor" })
    .subtract({ seconds: SYNC_SNAPSHOT_EVENT_TIME_MARGIN_SECONDS });
}

export const syncSubscriptionHandler = defineWriteHandler({
  name: "sync-subscription",
  agent: { expose: false },
  transaction: "perCommand",
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

    return ctx.dispatch.write(SubscriptionFoundationHandlers.applySubscriptionSnapshot, {
      providerName: sub.providerName,
      providerCustomerId: snapshot.providerCustomerId,
      providerSubscriptionId: snapshot.providerSubscriptionId,
      status: snapshot.status,
      tier: snapshot.tier,
      currentPeriodEnd: snapshot.currentPeriodEnd,
      cancelAt: snapshot.cancelAt,
      snapshotEventAtIso: snapshotEventTime().toString(),
    });
  },
});
