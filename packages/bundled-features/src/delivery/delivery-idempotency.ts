import type { NotifyDelivery, NotifyOptions, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import type { Logger } from "@cosmicdrift/kumiko-framework/logging";
import { redactErrorText } from "@cosmicdrift/kumiko-framework/logging";
import type { Redis } from "ioredis";
import { deliveryIdempotencyRedisKey } from "./constants.ts";
import type { DeliveryChannel } from "./types.ts";

// Idempotency: returns true the first time a key is seen, false on
// subsequent calls within the TTL window. Opt-in via options.idempotencyKey
// so callers decide when dedup matters (e.g. webhook replays, button
// double-clicks). Requires a Redis handle — configured via idempotencyRedis
// or reused from rateLimit.redis. notify() throws if the key is used without
// a backing Redis, so misconfigurations fail loud instead of silently double-sending.
export async function claimDeliveryIdempotency(
  redis: Redis | undefined,
  tenantId: TenantId,
  key: string,
  ttlSec = 86400,
): Promise<boolean> {
  if (!redis) {
    throw new Error(
      "Delivery idempotencyKey requires options.idempotencyRedis (or rateLimit.redis) to be configured",
    );
  }
  const res = await redis.set(deliveryIdempotencyRedisKey(tenantId, key), "1", "EX", ttlSec, "NX");
  return res === "OK";
}

function isDeliveredOrQueued(delivery: NotifyDelivery): boolean {
  return delivery.status === "sent" || delivery.status === "queued";
}

// A key that guarded nothing must not turn the caller's retry into a skipped duplicate.
// Partial success keeps it: a retry would re-send to those who got it.
// A failing release is logged and swallowed: it must neither replace the dispatch error the
// caller retries on nor fail a notify() that already dispatched.
export async function releaseIdempotencyIfNothingDelivered(args: {
  readonly redis: Redis | undefined;
  readonly log: Pick<Logger, "warn">;
  readonly tenantId: TenantId;
  readonly key: string | undefined;
  readonly deliveries: readonly NotifyDelivery[];
  readonly notificationType: string;
}): Promise<void> {
  const { redis, log, tenantId, key, deliveries, notificationType } = args;
  // skip: no key claimed, or a recipient already got the notification
  if (!key || deliveries.some(isDeliveredOrQueued)) return;
  try {
    await redis?.del(deliveryIdempotencyRedisKey(tenantId, key));
  } catch (releaseErr) {
    log.warn(
      `idempotency key release failed: ${redactErrorText(releaseErr instanceof Error ? releaseErr.message : String(releaseErr))}`,
      { notificationType },
    );
  }
}

// Only a single-channel route lets the queued job free the key on terminal failure
// without risking a duplicate send on another channel.
export function jobIdempotencyKeyFor(
  channels: readonly DeliveryChannel[],
  idempotencyKey: string | undefined,
  route: NotifyOptions["route"],
): string | undefined {
  if (!idempotencyKey || !route) return undefined;
  const routedChannelCount = channels.filter((channel) => route[channel.name]).length;
  return routedChannelCount === 1 ? idempotencyKey : undefined;
}
