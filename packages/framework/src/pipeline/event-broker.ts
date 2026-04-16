import type Redis from "ioredis";
import { parseJsonSafe } from "../utils/safe-json";
import { RedisKeys } from "./redis-keys";

export type BrokerEvent = {
  type: string;
  payload: Record<string, unknown>;
};

export type EventBroker = {
  publish(event: BrokerEvent): Promise<void>;
  // In-process synchronous dispatch. Runs all local subscribers for the
  // event type, aggregates their errors, and returns them. The outbox
  // poller uses this instead of publish() because publish() is Redis
  // pub/sub — async fire-and-forget — and the poller can't observe
  // subscriber failures through that path.
  dispatchLocal(event: BrokerEvent): Promise<readonly Error[]>;
  // Register a local subscriber. Handlers MUST be idempotent: the outbox
  // poller guarantees at-least-once delivery, so the same event may arrive
  // twice after retries. See outbox-poller.ts for the contract.
  subscribe(type: string, handler: (event: BrokerEvent) => Promise<void>): void;
  start(): Promise<void>;
  stop(): Promise<void>;
};

export function createEventBroker(publisher: Redis, subscriber: Redis): EventBroker {
  const channel = RedisKeys.events;
  const handlers = new Map<string, Array<(event: BrokerEvent) => Promise<void>>>();
  let started = false;
  let messageListener: ((ch: string, message: string) => void) | null = null;

  return {
    async publish(event) {
      await publisher.publish(channel, JSON.stringify(event));
    },

    async dispatchLocal(event) {
      const fns = handlers.get(event.type) ?? [];
      const errors: Error[] = [];
      for (const fn of fns) {
        try {
          await fn(event);
        } catch (e) {
          errors.push(e instanceof Error ? e : new Error(String(e)));
        }
      }
      return errors;
    },

    subscribe(type, handler) {
      const existing = handlers.get(type) ?? [];
      existing.push(handler);
      handlers.set(type, existing);
    },

    async start() {
      // skip: idempotent start
      if (started) return;
      started = true;

      // Cross-process subscriber path. Use only when you need this process to
      // receive events published by another process (e.g. multi-node setup).
      // In single-process deployments + tests the outbox poller's dispatchLocal
      // is the sole delivery path — start() is not called.
      await subscriber.subscribe(channel);
      messageListener = async (_ch, message) => {
        const event = parseJsonSafe<BrokerEvent | null>(message, null);
        if (!event) {
          // skip: corrupted broker message, log+drop rather than crash the worker
          return;
        }
        const fns = handlers.get(event.type) ?? [];
        for (const fn of fns) {
          try {
            await fn(event);
          } catch {
            // skip: cross-process dispatch errors are observability-only —
            // the outbox already considers the event delivered once it was
            // published. Proper handling requires a subscriber-side retry.
          }
        }
      };
      subscriber.on("message", messageListener);
    },

    async stop() {
      // skip: not started, nothing to tear down
      if (!started) return;
      started = false;

      if (messageListener) {
        subscriber.off("message", messageListener);
        messageListener = null;
      }
      try {
        await subscriber.unsubscribe(channel);
      } catch {
        // skip: subscriber may already be disconnected during shutdown
      }
    },
  };
}
