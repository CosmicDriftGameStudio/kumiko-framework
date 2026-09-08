import { createRedisPubSubSignal } from "../redis/pubsub-signal";
import { createSseBroker, type SseBroker, type SseEvent } from "./sse-broker";

// Channel namespace for cross-replica fanout (fw#2625). Every pod publishes
// here and every pod's psubscribe listens here, so a push on one instance
// reaches SSE clients connected to any other instance without a shared
// cursor — Pub/Sub for connected-client fanout, the event-store's shared
// cursor stays the mechanism for "read every event exactly once".
const CHANNEL_PREFIX = "kumiko:sse:ch:";
const INVALIDATION_PREFIX = "kumiko:sse:inval:";
const PSUBSCRIBE_PATTERN = "kumiko:sse:*";

export type RedisSseBrokerOptions = {
  readonly redisUrl: string;
};

export type RedisSseBroker = SseBroker & {
  // Not on SseBroker — the in-memory broker has nothing to release, but
  // this one owns two live ioredis connections (via the shared PubSubSignal).
  // buildServer only calls this when it created the broker itself (an
  // app-injected sseBroker owns its own lifecycle).
  close(): Promise<void>;
};

function isSseEvent(value: unknown): value is SseEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string" &&
    typeof (value as { data?: unknown }).data === "object" &&
    (value as { data?: unknown }).data !== null
  );
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
  const signal = createRedisPubSubSignal({
    redisUrl: opts.redisUrl,
    channelPattern: PSUBSCRIBE_PATTERN,
    label: "sse-broker",
  });

  signal.onMessage((channel, payload) => {
    if (channel.startsWith(CHANNEL_PREFIX)) {
      if (!isSseEvent(payload)) {
        console.error(`[kumiko:sse-broker] dropping malformed event on "${channel}"`);
        // skip: malformed payload already logged above, nothing to deliver
        return;
      }
      inner.pushToChannel(channel.slice(CHANNEL_PREFIX.length), payload);
      // skip: channel already routed to the SSE-event branch above, the
      // invalidation branch below is mutually exclusive with this one
      return;
    }

    if (channel.startsWith(INVALIDATION_PREFIX)) {
      inner.publishAccessInvalidation(channel.slice(INVALIDATION_PREFIX.length));
    }
  });

  return {
    addClient: inner.addClient,
    removeClient: inner.removeClient,
    getClientCount: inner.getClientCount,
    getTotalClientCount: inner.getTotalClientCount,
    subscribeAccessInvalidation: inner.subscribeAccessInvalidation,

    pushToChannel(channel, event) {
      signal.publish(`${CHANNEL_PREFIX}${channel}`, event);
    },

    // fw#1601: this is the security-critical call — a revoked session's
    // stream must close on every replica, not just the one that observed
    // the revocation event. Publishing (rather than calling inner directly,
    // like the in-memory broker does) is what makes that true here.
    publishAccessInvalidation(userId) {
      signal.publish(`${INVALIDATION_PREFIX}${userId}`, 1);
    },

    close: signal.close,
  };
}
