import type {
  CacheSyncBus,
  ClosableCacheSyncBus,
} from "@cosmicdrift/kumiko-types/cache-sync-types";
import { createFallbackLogger } from "../logging/utils.js";
import { type RedisClientOptions, redisClientOptionsFromEnv } from "./client.js";
import { createRedisPubSubSignal, type PubSubSignal } from "./pubsub-signal.js";

export type { CacheSyncBus, ClosableCacheSyncBus };

const log = createFallbackLogger("kumiko:cache-sync");
const CACHE_SYNC_CHANNEL = "kumiko:cache-sync";
const RESYNC_MIN_INTERVAL_MS = 5_000;

type CacheSyncEnvelope = {
  readonly origin: string;
  readonly topic: string;
  readonly message: unknown;
};

function isCacheSyncEnvelope(value: unknown): value is CacheSyncEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    "origin" in value &&
    typeof value.origin === "string" &&
    "topic" in value &&
    typeof value.topic === "string" &&
    "message" in value
  );
}

type LocalFanout = {
  deliver(topic: string, message: unknown): void;
  subscribe(topic: string, listener: (message: unknown) => void): () => void;
  onResync(listener: () => void): () => void;
  fireResync(): void;
};

function createLocalFanout(): LocalFanout {
  const subscribers = new Map<string, Set<(message: unknown) => void>>();
  const resyncListeners = new Set<() => void>();
  return {
    deliver(topic, message) {
      const listeners = subscribers.get(topic);
      // skip: nobody in this process listens on the topic
      if (!listeners) return;
      for (const listener of [...listeners]) {
        // A failing listener must not starve the others nor the publishing write or the redis event loop.
        try {
          listener(message);
        } catch (err) {
          log.error("subscriber threw", { topic, err });
        }
      }
    },
    subscribe(topic, listener) {
      let listeners = subscribers.get(topic);
      if (!listeners) {
        listeners = new Set();
        subscribers.set(topic, listeners);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onResync(listener) {
      resyncListeners.add(listener);
      return () => {
        resyncListeners.delete(listener);
      };
    },
    fireResync() {
      for (const listener of [...resyncListeners]) {
        try {
          listener();
        } catch (err) {
          log.error("resync listener threw", { err });
        }
      }
    },
  };
}

export function createLocalCacheSyncBus(): ClosableCacheSyncBus {
  const fanout = createLocalFanout();
  return {
    publish: fanout.deliver,
    subscribe: fanout.subscribe,
    onResync: fanout.onResync,
    async close() {},
  };
}

export type CacheSyncBusOverSignalOptions = {
  readonly channel: string;
  readonly originId?: string;
  readonly resyncMinIntervalMs?: number;
  readonly now?: () => number;
};

export function createCacheSyncBusOverSignal(
  signal: PubSubSignal,
  opts: CacheSyncBusOverSignalOptions,
): ClosableCacheSyncBus {
  const origin = opts.originId ?? crypto.randomUUID();
  const resyncMinIntervalMs = opts.resyncMinIntervalMs ?? RESYNC_MIN_INTERVAL_MS;
  const now = opts.now ?? Date.now;
  const fanout = createLocalFanout();

  signal.onMessage((_channel, payload) => {
    // skip: foreign or malformed payload on the channel
    if (!isCacheSyncEnvelope(payload)) return;
    // skip: own echo, already delivered locally by publish()
    if (payload.origin === origin) return;
    fanout.deliver(payload.topic, payload.message);
  });

  // Reconnect bursts collapse into one reload per interval; the trailing timer
  // keeps a reconnect inside the window from being dropped.
  let lastResyncAt = Number.NEGATIVE_INFINITY;
  let pendingResync: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const runResync = () => {
    pendingResync = undefined;
    lastResyncAt = now();
    fanout.fireResync();
  };
  signal.onReconnect(() => {
    // skip: bus closed, or a resync is already scheduled
    if (closed || pendingResync !== undefined) return;
    const wait = lastResyncAt + resyncMinIntervalMs - now();
    if (wait <= 0) {
      runResync();
    } else {
      pendingResync = setTimeout(runResync, wait);
      pendingResync.unref();
    }
  });

  return {
    publish(topic, message) {
      fanout.deliver(topic, message);
      const envelope: CacheSyncEnvelope = { origin, topic, message };
      signal.publish(opts.channel, envelope);
    },
    subscribe: fanout.subscribe,
    onResync: fanout.onResync,
    async close() {
      closed = true;
      if (pendingResync !== undefined) clearTimeout(pendingResync);
      await signal.close();
    },
  };
}

export type RedisCacheSyncBusOptions = {
  readonly redisUrl: string;
  readonly clientOptions?: RedisClientOptions;
  // The pub/sub connections carry no ioredis keyPrefix, so stacks sharing one
  // Redis (parallel test files) namespace the channel themselves.
  readonly channelPrefix?: string;
};

export function createRedisCacheSyncBus(opts: RedisCacheSyncBusOptions): ClosableCacheSyncBus {
  const channel = `${opts.channelPrefix ?? ""}${CACHE_SYNC_CHANNEL}`;
  const signal = createRedisPubSubSignal({
    redisUrl: opts.redisUrl,
    channelPattern: channel,
    label: "cache-sync",
    ...(opts.clientOptions ? { clientOptions: opts.clientOptions } : {}),
  });
  return createCacheSyncBusOverSignal(signal, { channel });
}

// Same REDIS_URL gate as createDefaultSseBroker: replicas > 1 are expected to
// set it. Without it invalidation stays inside this process.
export function createDefaultCacheSyncBus(
  envVars: Record<string, string | undefined> = process.env,
): ClosableCacheSyncBus {
  const redisUrl = envVars["REDIS_URL"];
  return redisUrl
    ? createRedisCacheSyncBus({ redisUrl, clientOptions: redisClientOptionsFromEnv(envVars) })
    : createLocalCacheSyncBus();
}

export type ResolvedCacheSyncBus = {
  readonly bus: CacheSyncBus | undefined;
  // Set when this call created the bus; its creator must close it on shutdown.
  readonly owned: ClosableCacheSyncBus | undefined;
};

// An explicit bus wins (caller owns it), null opts out, undefined builds the default.
export function resolveCacheSyncBus(
  explicit: CacheSyncBus | null | undefined,
): ResolvedCacheSyncBus {
  if (explicit) return { bus: explicit, owned: undefined };
  if (explicit === null) return { bus: undefined, owned: undefined };
  const owned = createDefaultCacheSyncBus();
  return { bus: owned, owned };
}
