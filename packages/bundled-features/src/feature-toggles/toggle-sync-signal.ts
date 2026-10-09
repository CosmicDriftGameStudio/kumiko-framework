import {
  CACHE_SYNC_TOPICS,
  type CacheSyncBus,
  createRedisPubSubSignal,
  type RedisClientOptions,
  redisChannelPrefixFromEnv,
} from "@cosmicdrift/kumiko-framework/redis";
import type { ToggleSyncSignal } from "./toggle-runtime.js";

// Single fixed channel — unlike the SSE broker there's no per-tenant/
// per-user variance to multiplex, every toggle flip is global.
const TOGGLE_SYNC_CHANNEL_NAME = "kumiko:feature-toggles:cache-sync";

export type RedisToggleSyncSignal = ToggleSyncSignal & {
  // Not on ToggleSyncSignal — the in-memory/no-signal path (GlobalFeature
  // ToggleRuntime without a signal) has nothing to release, but this one
  // owns two live ioredis connections via the shared PubSubSignal.
  close(): Promise<void>;
};

function isTogglePayload(value: unknown): value is { featureName: string; enabled: boolean } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { featureName?: unknown }).featureName === "string" &&
    typeof (value as { enabled?: unknown }).enabled === "boolean"
  );
}

// fw#2625: gives toggle-cache-sync the cross-replica transport its shared
// dispatcher cursor needs — without this, only the one process that won
// the shared cursor's toggle-set event would ever learn about a flip.
// Standalone Redis transport for callers that want their own connections;
// createFeatureToggleRuntime builds a cache-sync-bus signal by default.
export function createRedisToggleSyncSignal(
  redisUrl: string,
  clientOptions?: RedisClientOptions,
  channelPrefix: string = redisChannelPrefixFromEnv(),
): RedisToggleSyncSignal {
  const toggleSyncChannel = `${channelPrefix}${TOGGLE_SYNC_CHANNEL_NAME}`;
  const signal = createRedisPubSubSignal({
    redisUrl,
    channelPattern: toggleSyncChannel,
    label: "feature-toggles",
    ...(clientOptions ? { clientOptions } : {}),
  });

  return {
    publish(featureName, enabled) {
      signal.publish(toggleSyncChannel, { featureName, enabled });
    },
    onMessage(listener) {
      signal.onMessage((_channel, payload) => {
        if (!isTogglePayload(payload)) {
          // biome-ignore lint/suspicious/noConsole: ops-visible fallback — no ctx.log in a raw PubSubSignal handler.
          console.error(
            `[kumiko:feature-toggles] dropping malformed cache-sync message on "${toggleSyncChannel}"`,
          );
          // skip: malformed message already logged above, nothing to apply
          return;
        }
        listener(payload.featureName, payload.enabled);
      });
    },
    close: signal.close,
  };
}

// Reuses the framework cache-sync bus (local without REDIS_URL, Redis-backed with it) so
// toggles need no Pub/Sub wiring of their own. The bus applies a publish locally first.
export function createCacheSyncToggleSignal(bus: CacheSyncBus): ToggleSyncSignal {
  return {
    publish(featureName, enabled) {
      bus.publish(CACHE_SYNC_TOPICS.featureToggle, { featureName, enabled });
    },
    onMessage(listener) {
      bus.subscribe(CACHE_SYNC_TOPICS.featureToggle, (payload) => {
        // skip: foreign or malformed payload on the topic
        if (!isTogglePayload(payload)) return;
        listener(payload.featureName, payload.enabled);
      });
    },
    onResync(listener) {
      bus.onResync(listener);
    },
  };
}
