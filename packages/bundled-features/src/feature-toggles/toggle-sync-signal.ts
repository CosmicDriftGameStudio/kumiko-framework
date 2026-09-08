import { createRedisPubSubSignal } from "@cosmicdrift/kumiko-framework/redis";
import type { ToggleSyncSignal } from "./toggle-runtime";

// Single fixed channel — unlike the SSE broker there's no per-tenant/
// per-user variance to multiplex, every toggle flip is global.
const TOGGLE_SYNC_CHANNEL = "kumiko:feature-toggles:cache-sync";

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
// Same REDIS_URL-gated assumption as the SSE broker: a deployment with
// replicas > 1 is expected to set REDIS_URL, so app-boot code should build
// this only when REDIS_URL is present and pass it into
// createFeatureToggleRuntime.
export function createRedisToggleSyncSignal(redisUrl: string): RedisToggleSyncSignal {
  const signal = createRedisPubSubSignal({
    redisUrl,
    channelPattern: TOGGLE_SYNC_CHANNEL,
    label: "feature-toggles",
  });

  return {
    publish(featureName, enabled) {
      signal.publish(TOGGLE_SYNC_CHANNEL, { featureName, enabled });
    },
    onMessage(listener) {
      signal.onMessage((_channel, payload) => {
        if (!isTogglePayload(payload)) {
          // biome-ignore lint/suspicious/noConsole: ops-visible fallback — no ctx.log in a raw PubSubSignal handler.
          console.error(
            `[kumiko:feature-toggles] dropping malformed cache-sync message on "${TOGGLE_SYNC_CHANNEL}"`,
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
