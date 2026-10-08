import {
  type RedisClientOptions,
  redisChannelPrefixFromEnv,
  redisClientOptionsFromEnv,
} from "../redis/client.js";
import { createRedisPubSubSignal } from "../redis/pubsub-signal.js";
import {
  type AccessInvalidationScope,
  createSseBroker,
  readNonEmptyStringArray,
  type SseBroker,
  type SseEvent,
} from "./sse-broker.js";

// Channel namespace for cross-replica fanout (fw#2625). Every pod publishes
// here and every pod's psubscribe listens here, so a push on one instance
// reaches SSE clients connected to any other instance without a shared
// cursor — Pub/Sub for connected-client fanout, the event-store's shared
// cursor stays the mechanism for "read every event exactly once".
const CHANNEL_PREFIX = "kumiko:sse:ch:";
const INVALIDATION_PREFIX = "kumiko:sse:inval:";
const PSUBSCRIBE_SUFFIX = "kumiko:sse:*";

export type RedisSseBrokerOptions = {
  readonly redisUrl: string;
  readonly clientOptions?: RedisClientOptions;
  // Prepended to every channel (see redisChannelPrefixFromEnv); isolates apps sharing one Redis.
  readonly channelPrefix?: string;
};

export type RedisSseBroker = SseBroker & {
  readonly kind: "redis";
  // Not on SseBroker — the in-memory broker has nothing to release, but
  // this one owns two live ioredis connections (via the shared PubSubSignal).
  // buildServer only calls this when it created the broker itself (an
  // app-injected sseBroker owns its own lifecycle).
  close(): Promise<void>;
};

// Narrows on the `kind` discriminant, not on `close`: an app-owned SseBroker
// may have its own close() and must not be mistaken for the Redis one.
export function isRedisSseBroker(broker: SseBroker): broker is RedisSseBroker {
  return "kind" in broker && broker.kind === "redis";
}

// Single decision point for "which SseBroker should a caller default to
// when it doesn't inject its own": REDIS_URL present → cross-replica
// Redis-backed broker, absent → the in-memory one. Both buildServer and
// runProdApp must funnel through this rather than each deciding on their
// own — runProdApp doing exactly that (building an in-memory broker
// unconditionally, then passing it in as ServerOptions.sseBroker) is why
// fw#2625's fanout fix (fw#2630) shipped without ever taking effect in
// production: an explicit ServerOptions.sseBroker always wins in
// buildServer, so its own REDIS_URL-based default never ran.
export function createDefaultSseBroker(env: Record<string, string | undefined> = process.env): {
  readonly sseBroker: SseBroker;
  // Present only when REDIS_URL resolved. undefined means the fallback
  // in-memory broker was used, which has nothing to release on shutdown.
  readonly ownedRedisSseBroker: RedisSseBroker | undefined;
} {
  const redisUrl = env["REDIS_URL"];
  const ownedRedisSseBroker = redisUrl
    ? createRedisSseBroker({
        redisUrl,
        clientOptions: redisClientOptionsFromEnv(env),
        channelPrefix: redisChannelPrefixFromEnv(env),
      })
    : undefined;
  return { sseBroker: ownedRedisSseBroker ?? createSseBroker(), ownedRedisSseBroker };
}

function isSseEvent(value: unknown): value is SseEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string" &&
    typeof (value as { data?: unknown }).data === "object" &&
    (value as { data?: unknown }).data !== null
  );
}

// Invalidation payload: `1` means userwide, `{ keptSessionId }` spares that
// one session (all-except-session), `{ scope: "sessions", sessionIds }` /
// `{ scope: "pat-tokens", tokenIds }` narrow to those credentials. A newer
// scope payload NEVER carries a `keptSessionId` key, by construction —
// that's what makes it safe for an older pod (which only ever reads
// `keptSessionId`) to treat any of these as userwide instead of silently
// sparing something it doesn't understand: fail-closed on a mixed rolling
// deploy. Anything malformed also falls back to userwide.
function parseInvalidationScope(payload: unknown): AccessInvalidationScope {
  if (typeof payload !== "object" || payload === null) return { kind: "user" };
  const record = payload as Record<string, unknown>;

  if ("scope" in record) {
    const { scope } = record;
    if (scope === "sessions") {
      const sessionIds = readNonEmptyStringArray(record["sessionIds"]);
      if (sessionIds) return { kind: "sessions", sessionIds };
    }
    if (scope === "pat-tokens") {
      const tokenIds = readNonEmptyStringArray(record["tokenIds"]);
      if (tokenIds) return { kind: "pat-tokens", tokenIds };
    }
    return { kind: "user" };
  }

  if ("keptSessionId" in record) {
    const { keptSessionId } = record;
    if (typeof keptSessionId === "string" && keptSessionId.length > 0) {
      return { kind: "all-except-session", keptSessionId };
    }
    return { kind: "user" };
  }

  return { kind: "user" };
}

// Mirror of parseInvalidationScope's wire shapes. "sessions"/"pat-tokens"
// deliberately never include a `keptSessionId` key — see the parser comment.
function encodeInvalidationScope(scope: AccessInvalidationScope | undefined): unknown {
  if (scope === undefined || scope.kind === "user") return 1;
  if (scope.kind === "all-except-session") return { keptSessionId: scope.keptSessionId };
  if (scope.kind === "sessions") return { scope: "sessions", sessionIds: scope.sessionIds };
  return { scope: "pat-tokens", tokenIds: scope.tokenIds };
}

// Transport layer around a local `createSseBroker()` — all client/listener
// state lives in `inner`, this only moves events across the Redis wire via
// the shared PubSubSignal. `pushToChannel`/`publishAccessInvalidation` never
// call `inner` directly: they publish, and the signal's message handler
// below calls `inner` for BOTH the publishing pod and every other pod, so
// there's exactly one delivery path regardless of which instance receives
// the request.
export function createRedisSseBroker(opts: RedisSseBrokerOptions): RedisSseBroker {
  const inner = createSseBroker();
  const channelPrefix = `${opts.channelPrefix ?? ""}${CHANNEL_PREFIX}`;
  const invalidationPrefix = `${opts.channelPrefix ?? ""}${INVALIDATION_PREFIX}`;
  const signal = createRedisPubSubSignal({
    redisUrl: opts.redisUrl,
    channelPattern: `${opts.channelPrefix ?? ""}${PSUBSCRIBE_SUFFIX}`,
    label: "sse-broker",
    ...(opts.clientOptions ? { clientOptions: opts.clientOptions } : {}),
  });

  signal.onMessage((channel, payload) => {
    if (channel.startsWith(channelPrefix)) {
      if (!isSseEvent(payload)) {
        console.error(`[kumiko:sse-broker] dropping malformed event on "${channel}"`);
        // skip: malformed payload already logged above, nothing to deliver
        return;
      }
      inner.pushToChannel(channel.slice(channelPrefix.length), payload);
      // skip: channel already routed to the SSE-event branch above, the
      // invalidation branch below is mutually exclusive with this one
      return;
    }

    if (channel.startsWith(invalidationPrefix)) {
      inner.publishAccessInvalidation(
        channel.slice(invalidationPrefix.length),
        parseInvalidationScope(payload),
      );
    }
  });

  return {
    kind: "redis",
    addClient: inner.addClient,
    removeClient: inner.removeClient,
    getClientCount: inner.getClientCount,
    getTotalClientCount: inner.getTotalClientCount,
    subscribeAccessInvalidation: inner.subscribeAccessInvalidation,

    pushToChannel(channel, event) {
      signal.publish(`${channelPrefix}${channel}`, event);
    },

    // fw#1601: this is the security-critical call — a revoked session's
    // stream must close on every replica, not just the one that observed
    // the revocation event. Publishing (rather than calling inner directly,
    // like the in-memory broker does) is what makes that true here.
    publishAccessInvalidation(userId, scope) {
      return signal.publishConfirmed(
        `${invalidationPrefix}${userId}`,
        encodeInvalidationScope(scope),
      );
    },

    close: signal.close,
  };
}
