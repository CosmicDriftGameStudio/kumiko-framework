// Generic Stripe/PayPal-webhook → tier-engine sync route. Extracted from the
// near-identical webhook-route.ts app copies in show-pony and publicstatus
// (infra#446) — the only per-app variables were the TierName union/default,
// so it is now a factory parameter.

import {
  TierEngineHandlers,
  TierEngineQueries,
  tierAssignmentAggregateId,
} from "@cosmicdrift/kumiko-bundled-features/tier-engine";
import type {
  ExtraRouteDefinition,
  SignatureExtraRouteDeps,
} from "@cosmicdrift/kumiko-framework/api";
import type { TenantId, WriteResult } from "@cosmicdrift/kumiko-framework/engine";
import { subscriptionAggregateId } from "./aggregate-id";
import { SubscriptionFoundationQueries, SubscriptionStatuses } from "./constants";
import { createSubscriptionWebhookRoute } from "./webhook-handler";

// Outside /api — signature routes carry their own auth (verify()) and are
// not JWT-guarded, so provider dashboards (Stripe, PayPal, ...) point here.
export const SUBSCRIPTION_WEBHOOK_PATH = "/webhooks/subscription/:providerName";

// No db/tierAssignmentTable dep: extraRoutes are built before buildServer
// exists (no db at construction time), and handlers never see a raw db
// escape hatch either — the sync reads and writes exclusively through
// dispatchSystemQuery/dispatchSystemWrite in afterDispatch below.
export type SubscriptionTierSyncDeps<TTier extends string> = {
  readonly isTierName: (value: string) => value is TTier;
  readonly defaultTier: TTier;
  // "log" (default): sync failure only warns, the webhook still reports
  // success — right when the caller has no idempotent retry to lean on.
  // "fail-webhook": sync failure fails the webhook response too, so an
  // idempotent caller (e.g. Stripe, whose retry re-runs the already-committed
  // primary write as a no-op) gets a second attempt at the sync step itself.
  readonly onSyncError?: "log" | "fail-webhook";
};

export function effectiveTierFromSubscription<TTier extends string>(
  status: string | undefined,
  tier: string | undefined,
  isTierName: (value: string) => value is TTier,
  defaultTier: TTier,
): TTier {
  const usable = status === SubscriptionStatuses.active || status === SubscriptionStatuses.trialing;
  return usable && typeof tier === "string" && isTierName(tier) ? tier : defaultTier;
}

// Narrows an unknown dispatchSystemQuery result to its `{ rows }` list
// shape without an unchecked cast — a query returning something else
// (handler bug, or the handlerQn resolving to a non-list query) fails
// loudly instead of crashing on `.find` against `undefined`.
function asRows(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (
    typeof result === "object" &&
    result !== null &&
    Array.isArray((result as { rows?: unknown }).rows)
  ) {
    return (result as { rows: ReadonlyArray<Record<string, unknown>> }).rows;
  }
  throw new Error("expected a { rows: [...] } list-query result");
}

export function createSubscriptionTierSync<TTier extends string>(
  deps: SubscriptionTierSyncDeps<TTier>,
) {
  async function syncTierFromSubscription(
    tenantId: TenantId,
    routeDeps: SignatureExtraRouteDeps,
  ): Promise<{ code: string; message: string } | null> {
    try {
      const subscriptionId = subscriptionAggregateId(tenantId);
      const subscriptionRows = asRows(
        await routeDeps.dispatchSystemQuery({
          handlerQn: SubscriptionFoundationQueries.listSubscriptions,
          payload: {},
          tenantId,
        }),
      );
      const sub = subscriptionRows.find((row) => row["id"] === subscriptionId);
      if (!sub) return null;

      const effective = effectiveTierFromSubscription(
        typeof sub["status"] === "string" ? sub["status"] : undefined,
        typeof sub["tier"] === "string" ? sub["tier"] : undefined,
        deps.isTierName,
        deps.defaultTier,
      );

      const tierAssignmentRows = asRows(
        await routeDeps.dispatchSystemQuery({
          handlerQn: TierEngineQueries.list,
          payload: {},
          tenantId,
        }),
      );
      const assignment = tierAssignmentRows.find((row) => row["tenantId"] === tenantId);
      if (
        !assignment ||
        typeof assignment["id"] !== "string" ||
        typeof assignment["version"] !== "number"
      ) {
        const created = await routeDeps.dispatchSystemWrite({
          handlerQn: TierEngineHandlers.create,
          payload: { id: tierAssignmentAggregateId(tenantId), tier: effective },
          tenantId,
        });
        if (!created.isSuccess) {
          return {
            code: "tier_sync_failed",
            message: `tier-engine create with "${effective}" failed: ${created.error?.code ?? "unknown"}`,
          };
        }
        return null;
      }
      if (assignment["tier"] === effective) return null;

      const result = await routeDeps.dispatchSystemWrite({
        handlerQn: TierEngineHandlers.update,
        payload: {
          id: assignment["id"],
          version: assignment["version"],
          changes: { tier: effective },
        },
        tenantId,
      });
      if (!result.isSuccess) {
        return {
          code: "tier_sync_failed",
          message: `tier-engine update to "${effective}" failed: ${result.error?.code ?? "unknown"}`,
        };
      }
      return null;
    } catch (error) {
      // dispatchSystemQuery throws (AccessDenied/NotFound/Validation) rather
      // than returning an error envelope — e.g. a consumer that mounts
      // billing-foundation without tier-engine. Surface it the same way as
      // a failed dispatchSystemWrite instead of letting it bubble into the
      // webhook response as an unhandled 500.
      return {
        code: "tier_sync_failed",
        message: error instanceof Error ? error.message : "tier sync threw a non-Error value",
      };
    }
  }

  function createWebhookRoute(): ExtraRouteDefinition {
    return createSubscriptionWebhookRoute({
      path: SUBSCRIPTION_WEBHOOK_PATH,
      afterDispatch: async (dispatched: WriteResult, tenantId, routeDeps): Promise<WriteResult> => {
        const syncError = await syncTierFromSubscription(tenantId, routeDeps);
        if (syncError) {
          // biome-ignore lint/suspicious/noConsole: operator visibility for a post-commit sync failure
          console.warn(
            `[subscription-tier-sync] tier sync failed for tenant ${tenantId} after successful webhook write: ${syncError.code} ${syncError.message}`,
          );
          if (deps.onSyncError === "fail-webhook") {
            return {
              isSuccess: false,
              error: {
                code: syncError.code,
                httpStatus: 500,
                i18nKey: "errors.subscriptionTierSyncFailed",
                message: syncError.message,
              },
            };
          }
        }
        return dispatched;
      },
    });
  }

  return { createWebhookRoute };
}
