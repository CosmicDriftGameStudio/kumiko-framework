// Generic Stripe/PayPal-webhook → tier-engine sync route. Extracted from the
// near-identical webhook-route.ts app copies in show-pony and publicstatus
// (infra#446) — the only per-app variables were the TierName union/default
// and the tier-assignment table handle, so both are now factory parameters.

import {
  TierEngineHandlers,
  tierAssignmentAggregateId,
} from "@cosmicdrift/kumiko-bundled-features/tier-engine";
import { type DbRunner, type EntityTable, fetchOne } from "@cosmicdrift/kumiko-framework/db";
import type { EntityDefinition, Registry, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import type { Hono } from "hono";
import { subscriptionAggregateId } from "./aggregate-id";
import { SUBSCRIPTION_PROVIDER_EXTENSION, SubscriptionStatuses } from "./constants";
import { subscriptionsProjectionTable } from "./projection";
import type { SubscriptionProviderPlugin } from "./types";
import { createSubscriptionWebhookHandler } from "./webhook-handler";

export const SUBSCRIPTION_WEBHOOK_PATH = "/webhooks/subscription/:providerName";

export type SystemWriteResult = {
  readonly isSuccess: boolean;
  readonly data?: unknown;
  readonly error?: { readonly code?: string; readonly message?: string };
};

export type SubscriptionTierSyncDeps<TTier extends string> = {
  readonly db: DbRunner;
  readonly registry: Registry;
  readonly dispatchSystemWrite: (args: {
    readonly handlerQn: string;
    readonly payload: unknown;
    readonly tenantId: TenantId;
  }) => Promise<SystemWriteResult>;
  readonly tierAssignmentTable: EntityTable<EntityDefinition>;
  readonly isTierName: (value: string) => value is TTier;
  readonly defaultTier: TTier;
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

export function createSubscriptionTierSync<TTier extends string>(
  deps: SubscriptionTierSyncDeps<TTier>,
) {
  async function syncTierFromSubscription(
    tenantId: TenantId,
  ): Promise<{ code: string; message: string } | null> {
    const sub = await fetchOne<{ status?: unknown; tier?: unknown }>(
      deps.db,
      subscriptionsProjectionTable,
      { id: subscriptionAggregateId(tenantId) },
    );
    if (!sub) return null;

    const effective = effectiveTierFromSubscription(
      typeof sub.status === "string" ? sub.status : undefined,
      typeof sub.tier === "string" ? sub.tier : undefined,
      deps.isTierName,
      deps.defaultTier,
    );

    const assignment = await fetchOne<{ id?: unknown; version?: unknown; tier?: unknown }>(
      deps.db,
      deps.tierAssignmentTable,
      { tenantId },
    );
    if (
      !assignment ||
      typeof assignment.id !== "string" ||
      typeof assignment.version !== "number"
    ) {
      const created = await deps.dispatchSystemWrite({
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
    if (assignment.tier === effective) return null;

    const result = await deps.dispatchSystemWrite({
      handlerQn: TierEngineHandlers.update,
      payload: { id: assignment.id, version: assignment.version, changes: { tier: effective } },
      tenantId,
    });
    if (!result.isSuccess) {
      return {
        code: "tier_sync_failed",
        message: `tier-engine update to "${effective}" failed: ${result.error?.code ?? "unknown"}`,
      };
    }
    return null;
  }

  function wireSubscriptionWebhookRoute(app: Hono): void {
    const handler = createSubscriptionWebhookHandler({
      dispatchWrite: async ({ handlerQn, payload, tenantId }) => {
        const targetTenantId = tenantId as TenantId;
        const result = await deps.dispatchSystemWrite({
          handlerQn,
          payload,
          tenantId: targetTenantId,
        });
        if (!result.isSuccess) return result;
        // The primary write already committed — a webhook caller (Stripe/
        // PayPal) that sees isSuccess:false here retries the whole event,
        // re-running an already-succeeded side effect. Log the tier-sync
        // failure instead of masking the primary write's success.
        const syncError = await syncTierFromSubscription(targetTenantId);
        if (syncError) {
          // biome-ignore lint/suspicious/noConsole: operator visibility for a post-commit sync failure
          console.warn(
            `[subscription-tier-sync] tier sync failed for tenant ${targetTenantId} after successful webhook write: ${syncError.code} ${syncError.message}`,
          );
        }
        return result;
      },
      resolveProvider: (providerName) => {
        const usage = deps.registry
          .getExtensionUsages(SUBSCRIPTION_PROVIDER_EXTENSION)
          .find((u) => u.entityName === providerName);
        return usage?.options as SubscriptionProviderPlugin | undefined;
      },
    });
    app.post(SUBSCRIPTION_WEBHOOK_PATH, handler);
  }

  return { wireSubscriptionWebhookRoute };
}
