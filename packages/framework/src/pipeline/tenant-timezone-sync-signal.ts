import type { TenantId } from "../engine/types/identifiers.js";
import { type RedisClientOptions, redisClientOptionsFromEnv } from "../redis/client.js";
import { createRedisPubSubSignal } from "../redis/pubsub-signal.js";

// Tells every replica to drop its tenantTimezoneCache entry (the cache is
// per process, so a config write on one pod would otherwise stay invisible to
// the others until the TTL expires).
export type TenantTimezoneInvalidation =
  | { readonly tenantId: TenantId }
  | { readonly scope: "all" };

export type TenantTimezoneSyncSignal = {
  publish(invalidation: TenantTimezoneInvalidation): void;
  onMessage(listener: (invalidation: TenantTimezoneInvalidation) => void): void;
};

export type RedisTenantTimezoneSyncSignal = TenantTimezoneSyncSignal & {
  close(): Promise<void>;
};

const TENANT_TIMEZONE_SYNC_CHANNEL = "kumiko:tenant-timezone:cache-sync";

function isTenantTimezoneInvalidation(value: unknown): value is TenantTimezoneInvalidation {
  if (typeof value !== "object" || value === null) return false;
  if ("scope" in value) return value.scope === "all";
  return "tenantId" in value && typeof value.tenantId === "string";
}

export type RedisTenantTimezoneSyncOptions = {
  readonly redisUrl: string;
  readonly clientOptions?: RedisClientOptions;
  // The pub/sub connections carry no ioredis keyPrefix, so stacks sharing one
  // Redis (parallel test files) namespace the channel themselves.
  readonly channelPrefix?: string;
};

export function createRedisTenantTimezoneSyncSignal(
  opts: RedisTenantTimezoneSyncOptions,
): RedisTenantTimezoneSyncSignal {
  const channel = `${opts.channelPrefix ?? ""}${TENANT_TIMEZONE_SYNC_CHANNEL}`;
  const signal = createRedisPubSubSignal({
    redisUrl: opts.redisUrl,
    channelPattern: channel,
    label: "tenant-timezone",
    ...(opts.clientOptions ? { clientOptions: opts.clientOptions } : {}),
  });

  return {
    publish(invalidation) {
      signal.publish(channel, invalidation);
    },
    onMessage(listener) {
      signal.onMessage((_channel, payload) => {
        // skip: foreign or malformed payload, nothing to apply
        if (!isTenantTimezoneInvalidation(payload)) return;
        listener(payload);
      });
    },
    close: signal.close,
  };
}

// Same REDIS_URL gate as createDefaultSseBroker: replicas > 1 are expected to
// set it. Without it the cache stays per-process, as before.
export function createDefaultTenantTimezoneSync(
  envVars: Record<string, string | undefined> = process.env,
): RedisTenantTimezoneSyncSignal | undefined {
  const redisUrl = envVars["REDIS_URL"];
  return redisUrl
    ? createRedisTenantTimezoneSyncSignal({
        redisUrl,
        clientOptions: redisClientOptionsFromEnv(envVars),
      })
    : undefined;
}
