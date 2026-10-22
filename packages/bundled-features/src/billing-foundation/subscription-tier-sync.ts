// Generic Stripe/PayPal-webhook → tier-engine sync route. Extracted from the
// near-identical webhook-route.ts app copies in show-pony and publicstatus — the
// only per-app variables were the TierName union/default, so it is now a factory
// parameter.

import {
  isTierAssignmentSource,
  type TierAssignmentSource,
  TierAssignmentSources,
  TierEngineHandlers,
  TierEngineQueries,
  tierAssignmentAggregateId,
} from "@cosmicdrift/kumiko-bundled-features/tier-engine";
import type {
  ExtraRouteDefinition,
  SignatureExtraRouteDeps,
} from "@cosmicdrift/kumiko-framework/api";
import type { TenantId, WriteResult } from "@cosmicdrift/kumiko-framework/engine";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { subscriptionAggregateId } from "./aggregate-id.ts";
import type { PaymentEvent, SubscriptionEvent } from "./types.ts";
import { SubscriptionFoundationQueries, SubscriptionStatuses } from "./web/constants.ts";
import { createSubscriptionWebhookRoute } from "./webhook-handler.ts";

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
  /** Runs after every webhook whose sync succeeded, also when the tier stayed the same
   *  (`changed: false`). Not called when the tenant has no subscription yet, when a
   *  manual grant was kept, or when the sync failed. A throw counts as a sync failure
   *  and follows `onSyncError`. */
  readonly afterSync?: (result: TierSyncResult<TTier>) => Promise<void>;
};

export type TierSyncResult<TTier extends string> = {
  readonly tenantId: TenantId;
  /** The tier the subscription yields. */
  readonly tier: TTier;
  /** True when this sync created or updated the tenant's tier assignment. */
  readonly changed: boolean;
  readonly event: SubscriptionEvent | PaymentEvent;
};

type SyncError = { code: string; message: string };
type SyncOutcome<TTier extends string> =
  | { readonly error: SyncError }
  | {
      readonly error: null;
      readonly applied?: { readonly tier: TTier; readonly changed: boolean };
    };

// A manual grant that differs from what billing would assign is reported with this
// code but never fails the webhook: a provider retry cannot resolve it.
export const TIER_SYNC_MANUAL_GRANT_SKIPPED = "tier_sync_manual_grant_skipped";

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
  if (isPlainObject(result) && Array.isArray(result["rows"])) {
    return result["rows"];
  }
  throw new Error("expected a { rows: [...] } list-query result");
}

type ExistingTierAssignment = {
  readonly id: string;
  readonly version: number;
  readonly tier: unknown;
  readonly source: TierAssignmentSource | null;
};

function findTierAssignment(
  rows: ReadonlyArray<Record<string, unknown>>,
  tenantId: TenantId,
): ExistingTierAssignment | undefined {
  const row = rows.find((candidate) => candidate["tenantId"] === tenantId);
  if (!row || typeof row["id"] !== "string" || typeof row["version"] !== "number") {
    return undefined;
  }
  const source = row["source"];
  return {
    id: row["id"],
    version: row["version"],
    tier: row["tier"],
    source: isTierAssignmentSource(source) ? source : null,
  };
}

export function createSubscriptionTierSync<TTier extends string>(
  deps: SubscriptionTierSyncDeps<TTier>,
) {
  async function runTierSync(
    tenantId: TenantId,
    routeDeps: Pick<SignatureExtraRouteDeps, "dispatchSystemQuery" | "dispatchSystemWrite">,
  ): Promise<SyncOutcome<TTier>> {
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
      if (!sub) return { error: null };

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
      const assignment = findTierAssignment(tierAssignmentRows, tenantId);
      if (!assignment) {
        const created = await routeDeps.dispatchSystemWrite({
          handlerQn: TierEngineHandlers.create,
          payload: {
            id: tierAssignmentAggregateId(tenantId),
            tier: effective,
            source: TierAssignmentSources.billing,
          },
          tenantId,
        });
        if (!created.isSuccess) {
          return {
            error: {
              code: "tier_sync_failed",
              message: `tier-engine create with "${effective}" failed: ${created.error?.code ?? "unknown"}`,
            },
          };
        }
        return { error: null, applied: { tier: effective, changed: true } };
      }
      if (assignment.tier === effective) {
        return { error: null, applied: { tier: effective, changed: false } };
      }
      if (assignment.source === TierAssignmentSources.manual) {
        return {
          error: {
            code: TIER_SYNC_MANUAL_GRANT_SKIPPED,
            message: `manual tier grant "${String(assignment.tier)}" kept although the subscription yields "${effective}"`,
          },
        };
      }

      const result = await routeDeps.dispatchSystemWrite({
        handlerQn: TierEngineHandlers.update,
        payload: {
          id: assignment.id,
          version: assignment.version,
          changes: { tier: effective, source: TierAssignmentSources.billing },
        },
        tenantId,
      });
      if (!result.isSuccess) {
        return {
          error: {
            code: "tier_sync_failed",
            message: `tier-engine update to "${effective}" failed: ${result.error?.code ?? "unknown"}`,
          },
        };
      }
      return { error: null, applied: { tier: effective, changed: true } };
    } catch (error) {
      // dispatchSystemQuery throws (AccessDenied/NotFound/Validation) rather
      // than returning an error envelope — e.g. a consumer that mounts
      // billing-foundation without tier-engine. Surface it the same way as
      // a failed dispatchSystemWrite instead of letting it bubble into the
      // webhook response as an unhandled 500.
      return {
        error: {
          code: "tier_sync_failed",
          message: error instanceof Error ? error.message : "tier sync threw a non-Error value",
        },
      };
    }
  }

  async function syncTierFromSubscription(
    tenantId: TenantId,
    routeDeps: Pick<SignatureExtraRouteDeps, "dispatchSystemQuery" | "dispatchSystemWrite">,
  ): Promise<SyncError | null> {
    return (await runTierSync(tenantId, routeDeps)).error;
  }

  async function syncAndNotify(
    tenantId: TenantId,
    event: SubscriptionEvent | PaymentEvent,
    routeDeps: Pick<SignatureExtraRouteDeps, "dispatchSystemQuery" | "dispatchSystemWrite">,
  ): Promise<SyncError | null> {
    const outcome = await runTierSync(tenantId, routeDeps);
    if (outcome.error !== null || outcome.applied === undefined || !deps.afterSync) {
      return outcome.error;
    }
    try {
      await deps.afterSync({ tenantId, event, ...outcome.applied });
      return null;
    } catch (error) {
      return {
        code: "tier_sync_after_hook_failed",
        message: error instanceof Error ? error.message : "afterSync threw a non-Error value",
      };
    }
  }

  // `path` must keep the `:providerName` param the webhook route resolves the provider from.
  function createWebhookRoute(options: { readonly path?: string } = {}): ExtraRouteDefinition {
    return createSubscriptionWebhookRoute({
      path: options.path ?? SUBSCRIPTION_WEBHOOK_PATH,
      afterDispatch: async (
        dispatched: WriteResult,
        tenantId,
        routeDeps,
        event,
      ): Promise<WriteResult> => {
        const syncError = await syncAndNotify(tenantId, event, routeDeps);
        if (syncError) {
          // biome-ignore lint/suspicious/noConsole: operator visibility for a post-commit sync failure
          console.warn(
            `[subscription-tier-sync] tier sync for tenant ${tenantId} after successful webhook write: ${syncError.code} ${syncError.message}`,
          );
          if (
            deps.onSyncError === "fail-webhook" &&
            syncError.code !== TIER_SYNC_MANUAL_GRANT_SKIPPED
          ) {
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

  return { createWebhookRoute, syncTierFromSubscription, syncAndNotify };
}
