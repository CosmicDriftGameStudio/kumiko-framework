// apply-subscription-snapshot — the append half of `sync-subscription`. The provider call runs
// there, outside any transaction; this handler takes the snapshot in, locks the subscription
// stream, re-reads the row and appends the drift as `subscription.updated` (or
// `subscription.canceled`, when the snapshot's own status is terminal).
//
// SYSTEM_ROLE: it is dispatched from the `sync-subscriptions` job's system user.

import { createHash } from "node:crypto";
import { defineWriteHandler, SYSTEM_ROLE, type WriteResult } from "@cosmicdrift/kumiko-framework/engine";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { subscriptionAggregateId } from "../aggregate-id.ts";
import { getSubscriptionForTenant } from "../get-subscription-for-tenant.ts";
import { isTerminalSubscriptionStatus, SubscriptionEventTypes } from "../web/constants.ts";
import {
  appendSubscriptionEvent,
  lockAndLoadSubscriptionStream,
  processEventSchema,
} from "./process-event.write.ts";

export type SyncSubscriptionSkipReason =
  | "no_live_subscription"
  | "provider_cannot_retrieve"
  | "not_found"
  | "unchanged";

export type SyncSubscriptionResult =
  | { readonly synced: true }
  | { readonly synced: false; readonly reason: SyncSubscriptionSkipReason };

export const applySubscriptionSnapshotSchema = processEventSchema
  .pick({
    providerName: true,
    providerCustomerId: true,
    providerSubscriptionId: true,
    status: true,
    tier: true,
  })
  .extend({
    currentPeriodEnd: z.string().min(1),
    cancelAt: z.string().min(1).nullable(),
    snapshotEventAtIso: z.iso.datetime(),
  })
  .strict();

// Parses both sides fresh via Temporal before comparing — tolerant of a
// provider snapshot's ISO string using a different (but equivalent)
// representation than `Temporal.Instant#toString()`'s canonical form
// (offset spelling, sub-second precision, ...), unlike a plain `===` on the
// raw strings.
function isoInstantsEqual(a: string, b: string): boolean {
  return Temporal.Instant.compare(Temporal.Instant.from(a), Temporal.Instant.from(b)) === 0;
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

export const applySubscriptionSnapshotHandler = defineWriteHandler({
  name: "apply-subscription-snapshot",
  agent: { expose: false },
  schema: applySubscriptionSnapshotSchema,
  access: { roles: [SYSTEM_ROLE, "SystemAdmin"] },
  handler: async (event, ctx): Promise<WriteResult<SyncSubscriptionResult>> => {
    const tenantId = event.user.tenantId;
    const snapshot = event.payload;

    const lockedStream = await lockAndLoadSubscriptionStream(
      ctx,
      subscriptionAggregateId(tenantId),
    );

    // The subscription can change or be replaced while the provider answered, so the row is
    // re-read under the stream lock.
    const sub = await getSubscriptionForTenant(ctx, tenantId);
    if (
      !sub ||
      isTerminalSubscriptionStatus(sub.status) ||
      sub.providerSubscriptionId !== snapshot.providerSubscriptionId ||
      sub.providerName !== snapshot.providerName
    ) {
      return {
        isSuccess: true as const,
        data: { synced: false, reason: "no_live_subscription" } satisfies SyncSubscriptionResult,
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

    const appendResult = await appendSubscriptionEvent(
      ctx,
      tenantId,
      {
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
        providerEventAtIso: snapshot.snapshotEventAtIso,
      },
      undefined,
      undefined,
      lockedStream,
    );

    return {
      isSuccess: true as const,
      data: (appendResult.duplicate || appendResult.stale
        ? { synced: false, reason: "unchanged" }
        : { synced: true }) satisfies SyncSubscriptionResult,
    };
  },
});
