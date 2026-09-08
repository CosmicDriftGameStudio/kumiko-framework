import { createRedisClient } from "./client";

// Generic Redis Pub/Sub transport for cross-replica fanout (fw#2625).
// Shared by the SSE broker (api/redis-sse-broker.ts, several logical
// channels multiplexed under one prefix) and feature-toggles' cache-sync
// signal (bundled-features, a single fixed channel) — both need the same
// mechanics: two connections (ioredis forbids normal commands on a
// subscriber connection), one psubscribe per instance (no per-channel
// subscribe/unsubscribe), JSON payloads, and defensive parsing so a
// malformed or foreign message on the pattern never crashes the listener.
export type PubSubSignal = {
  publish(channel: string, payload: unknown): void;
  onMessage(listener: (channel: string, payload: unknown) => void): void;
  close(): Promise<void>;
};

export type PubSubSignalOptions = {
  readonly redisUrl: string;
  // psubscribe pattern: a literal channel name is a valid (exact-match)
  // pattern for a caller with a single fixed channel; a "prefix:*" glob
  // is for a caller that multiplexes several logical channels under one
  // subscription (e.g. the SSE broker's per-tenant/per-user channels).
  readonly channelPattern: string;
  // Included in every log line so two signals running in the same process
  // (sse-broker, feature-toggles cache-sync) can be told apart in output.
  readonly label: string;
};

// Redis emits 'error' on connection blips (reconnects transparently); an
// unhandled listener crashes the process (fw#1805 — job-runner hit the same
// class with BullMQ's internal client).
function logConnectionError(label: string, role: string): (err: Error) => void {
  return (err) => {
    // biome-ignore lint/suspicious/noConsole: ops-visible fallback — no logger is threaded through PubSubSignalOptions.
    console.error(`[kumiko:${label}] ${role} connection error:`, err.message);
  };
}

export function createRedisPubSubSignal(opts: PubSubSignalOptions): PubSubSignal {
  const publisher = createRedisClient(opts.redisUrl);
  const subscriber = createRedisClient(opts.redisUrl);
  publisher.on("error", logConnectionError(opts.label, "publisher"));
  subscriber.on("error", logConnectionError(opts.label, "subscriber"));

  const listeners = new Set<(channel: string, payload: unknown) => void>();
  // Sole purpose: stop close() from racing the initial psubscribe (see
  // below) and silence its logging once a shutdown is already underway —
  // not a defense against ioredis auto-reconnecting later (quit() below
  // never reconnects once it resolves).
  let closed = false;

  subscriber.on("pmessage", (_pattern: string, channel: string, message: string) => {
    let payload: unknown;
    try {
      payload = JSON.parse(message);
    } catch (err) {
      // biome-ignore lint/suspicious/noConsole: ops-visible fallback, see logConnectionError above.
      console.error(`[kumiko:${opts.label}] dropping unparseable message on "${channel}":`, err);
      // skip: unparseable payload already logged above, nothing to deliver
      return;
    }
    for (const listener of listeners) listener(channel, payload);
  });

  // ponytail: psubscribe on one pattern rather than per-channel
  // subscribe/unsubscribe — every instance receives every message that
  // matches, filtered by the caller. That's strictly no worse than the
  // pre-fw#2625 per-instance-cursor model (which already read every event
  // from Postgres in every process) and sidesteps the subscribe-ack/
  // first-publish race a per-channel scheme would have. Revisit with
  // per-channel subscribe only if fanout volume becomes the bottleneck.
  //
  // Awaited by close() below — quitting while this is still in flight (a
  // shutdown landing immediately after construction, e.g. a test closing
  // right after building the signal) makes ioredis rejects the queued
  // psubscribe with "Connection is closed" instead of it completing
  // cleanly first. Not caught here or logged when a close is already
  // underway (`closed`), so an intentional shutdown never surfaces this
  // as an ops-visible error.
  const initialSubscribe = subscriber.psubscribe(opts.channelPattern).catch((err: unknown) => {
    // skip: a close() already underway intentionally quit both connections —
    // this rejection is the expected side effect, not an ops-visible error.
    if (closed) return;
    // biome-ignore lint/suspicious/noConsole: ops-visible fallback, see logConnectionError above.
    console.error(`[kumiko:${opts.label}] psubscribe failed:`, err);
  });

  return {
    publish(channel, payload) {
      publisher.publish(channel, JSON.stringify(payload)).catch((err: unknown) => {
        // skip: a close() already underway intentionally quit both
        // connections — this rejection is the expected side effect.
        if (closed) return;
        // biome-ignore lint/suspicious/noConsole: ops-visible fallback, see logConnectionError above.
        console.error(`[kumiko:${opts.label}] publish failed:`, err);
      });
    },
    onMessage(listener) {
      listeners.add(listener);
    },
    async close(): Promise<void> {
      closed = true;
      await initialSubscribe;
      await Promise.all([publisher.quit(), subscriber.quit()]);
    },
  };
}
