import { createRedisClient } from "../redis";
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
  // this one owns two live ioredis connections. buildServer only calls
  // this when it created the broker itself (an app-injected sseBroker
  // owns its own lifecycle).
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

// Redis emits 'error' on connection blips (reconnects transparently); an
// unhandled listener crashes the process (fw#1805 — job-runner hit the same
// class with BullMQ's internal client).
function logConnectionError(label: string): (err: Error) => void {
  return (err) => {
    console.error(`[kumiko:sse-broker] ${label} connection error:`, err.message);
  };
}

function logPublishFailure(label: string): (err: unknown) => void {
  return (err) => {
    console.error(`[kumiko:sse-broker] ${label} publish failed:`, err);
  };
}

// Transport layer around a local `createSseBroker()` — all client/listener
// state lives in `inner`, this only moves events across the Redis wire.
// `pushToChannel`/`publishAccessInvalidation` never call `inner` directly:
// they publish, and the psubscribe handler below calls `inner` for BOTH the
// publishing pod and every other pod, so there's exactly one delivery path
// regardless of which instance receives the request.
export function createRedisSseBroker(opts: RedisSseBrokerOptions): RedisSseBroker {
  const inner = createSseBroker();
  const publisher = createRedisClient(opts.redisUrl);
  const subscriber = createRedisClient(opts.redisUrl);
  publisher.on("error", logConnectionError("publisher"));
  subscriber.on("error", logConnectionError("subscriber"));

  subscriber.on("pmessage", (_pattern: string, channel: string, message: string) => {
    let payload: unknown;
    try {
      payload = JSON.parse(message);
    } catch (err) {
      console.error(`[kumiko:sse-broker] dropping unparseable message on "${channel}":`, err);
      return;
    }

    if (channel.startsWith(CHANNEL_PREFIX)) {
      if (!isSseEvent(payload)) {
        console.error(`[kumiko:sse-broker] dropping malformed event on "${channel}"`);
        return;
      }
      inner.pushToChannel(channel.slice(CHANNEL_PREFIX.length), payload);
      return;
    }

    if (channel.startsWith(INVALIDATION_PREFIX)) {
      inner.publishAccessInvalidation(channel.slice(INVALIDATION_PREFIX.length));
    }
  });

  // ponytail: psubscribe on one broad pattern means every pod receives
  // every SSE + access-invalidation event, filtered locally by prefix —
  // there's no per-channel subscribe/unsubscribe. That's strictly better
  // than the pre-fix per-instance-cursor model (which already read every
  // event from Postgres in every process) and sidesteps the subscribe-ack
  // race a per-channel scheme would have. Revisit with per-channel
  // subscribe only if fanout volume actually becomes the bottleneck.
  subscriber.psubscribe(PSUBSCRIBE_PATTERN).catch((err: unknown) => {
    console.error("[kumiko:sse-broker] psubscribe failed:", err);
  });

  return {
    addClient: inner.addClient,
    removeClient: inner.removeClient,
    getClientCount: inner.getClientCount,
    getTotalClientCount: inner.getTotalClientCount,
    subscribeAccessInvalidation: inner.subscribeAccessInvalidation,

    pushToChannel(channel, event) {
      publisher
        .publish(`${CHANNEL_PREFIX}${channel}`, JSON.stringify(event))
        .catch(logPublishFailure("pushToChannel"));
    },

    // fw#1601: this is the security-critical call — a revoked session's
    // stream must close on every replica, not just the one that observed
    // the revocation event. Publishing (rather than calling inner directly,
    // like the in-memory broker does) is what makes that true here.
    publishAccessInvalidation(userId) {
      publisher
        .publish(`${INVALIDATION_PREFIX}${userId}`, "1")
        .catch(logPublishFailure("publishAccessInvalidation"));
    },

    async close(): Promise<void> {
      await Promise.all([publisher.quit(), subscriber.quit()]);
    },
  };
}
