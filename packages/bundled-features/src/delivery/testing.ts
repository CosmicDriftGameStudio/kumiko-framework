import type { SseBroker } from "@cosmicdrift/kumiko-framework/api";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { Registry, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import type { Redis } from "ioredis";
import type { KillSwitchResolver, RateLimitConfig } from "./delivery-service";
import { collectChannels, createDeliveryService } from "./delivery-service";
import type { DeliveryService } from "./types";

export type CreateDeliveryTestContextOptions = {
  readonly tenantUserIdsQuery?: string;
  readonly rateLimit?: RateLimitConfig;
  readonly isChannelKilled?: KillSwitchResolver;
};

/**
 * Helper for setupTestStack: creates a DeliveryService + _notifyFactory for the test context.
 * Abstracts the boilerplate that every Delivery-using test needs.
 *
 * Usage:
 *   setupTestStack({
 *     features: [...],
 *     extraContext: (deps) => createDeliveryTestContext(deps, { tenantUserIdsQuery: TenantQueries.resolveUserIds }),
 *   });
 */
export function createDeliveryTestContext(
  deps: { registry: Registry; db: DbConnection; sseBroker: SseBroker; redis: Redis },
  options: CreateDeliveryTestContextOptions = {},
): Record<string, unknown> & { deliveryService: DeliveryService } {
  const { registry, db, sseBroker } = deps;
  const channels = collectChannels(registry);
  const deliveryService = createDeliveryService({
    db,
    registry,
    sseBroker,
    channels,
    ...options,
  });

  return {
    deliveryService, // exposed so tests can inspect/call directly if needed
    _notifyFactory:
      (user: { id: number; tenantId: TenantId }, tenantId: TenantId) =>
      (notificationType: string, notifyOptions: Record<string, unknown>) =>
        deliveryService.notify(notificationType, notifyOptions as never, user as never, tenantId), // @cast-boundary engine-bridge
  };
}
