import type { SseBroker } from "@cosmicdrift/kumiko-framework/api";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type {
  ConfigAccessor,
  EscapeHatchAuditSink,
  Registry,
  TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import type { FileContext } from "@cosmicdrift/kumiko-framework/files";
import type { JobRunner } from "@cosmicdrift/kumiko-framework/jobs";
import type { Logger } from "@cosmicdrift/kumiko-framework/logging";
import type { EnvelopeCipher, SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import type { Redis } from "ioredis";
import type { KillSwitchResolver, RateLimitConfig } from "./delivery-service.ts";
import { collectChannels, createDeliveryService } from "./delivery-service.ts";
import { createDeliveryNotifyFactory } from "./notify-factory.ts";
import type { DeliveryService } from "./types.ts";
import type { UnsubscribeLinkConfig } from "./unsubscribe-link.ts";

export type CreateDeliveryTestContextOptions = {
  readonly tenantUserIdsQuery?: string;
  readonly rateLimit?: RateLimitConfig;
  readonly isChannelKilled?: KillSwitchResolver;
  readonly escapeHatchAuditSink?: EscapeHatchAuditSink;
  readonly log?: Logger;
  readonly jobRunner?: JobRunner;
  readonly secrets?: SecretsContext;
  // Seals queued job payload addresses and, like the boot wiring, doubles as the jobs' ctx.configEncryption.
  readonly addressCipher?: EnvelopeCipher;
  readonly idempotencyRedis?: Redis;
  readonly filesForTenant?: (tenantId: string) => FileContext | undefined;
  readonly tenantConfigFor?: (tenantId: TenantId) => ConfigAccessor;
  readonly unsubscribeLinks?: UnsubscribeLinkConfig;
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
    _notifyFactory: createDeliveryNotifyFactory(deliveryService),
    ...(options.addressCipher && { configEncryption: options.addressCipher }),
  };
}
