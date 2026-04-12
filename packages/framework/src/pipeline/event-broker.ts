import type Redis from "ioredis";
import { RedisKeys } from "./redis-keys";

export type BrokerEvent = {
  type: string;
  payload: Record<string, unknown>;
};

export type EventBroker = {
  publish(event: BrokerEvent): Promise<void>;
  subscribe(type: string, handler: (event: BrokerEvent) => Promise<void>): void;
  start(): Promise<void>;
  stop(): Promise<void>;
};

export function createEventBroker(publisher: Redis, subscriber: Redis): EventBroker {
  const channel = RedisKeys.events;
  const handlers = new Map<string, Array<(event: BrokerEvent) => Promise<void>>>();

  return {
    async publish(event) {
      await publisher.publish(channel, JSON.stringify(event));
    },

    subscribe(type, handler) {
      const existing = handlers.get(type) ?? [];
      existing.push(handler);
      handlers.set(type, existing);
    },

    async start() {
      await subscriber.subscribe(channel);
      subscriber.on("message", async (_ch, message) => {
        const event = JSON.parse(message) as BrokerEvent;
        const fns = handlers.get(event.type) ?? [];
        await Promise.all(fns.map((fn) => fn(event)));
      });
    },

    async stop() {
      await subscriber.unsubscribe(channel);
    },
  };
}
