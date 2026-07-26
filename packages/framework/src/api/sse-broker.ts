import { userAccessChannel } from "../engine/constants";
import { generateId } from "../utils";

export type SseClient = {
  id: string;
  send: (event: SseEvent) => void;
  close: () => void;
};

export type SseEvent = {
  type: string;
  data: Record<string, unknown>;
};

export type SseBroker = {
  addClient(channel: string, send: (event: SseEvent) => void, close: () => void): string;
  removeClient(channel: string, clientId: string): void;
  pushToChannel(channel: string, event: SseEvent): void;
  getClientCount(channel: string): number;
  getTotalClientCount(): number;
  // Internal (non-SSE-client) subscription, e.g. dispatch-stream watching
  // for mid-stream access revocation. Kept separate from addClient/
  // pushToChannel: those count towards getClientCount/getTotalClientCount
  // (real SSE connections) and their send/close shape doesn't fit a plain
  // callback listener. Returns an unsubscribe function.
  subscribeAccessInvalidation(userId: string, onInvalidate: () => void): () => void;
  publishAccessInvalidation(userId: string): void;
};

export function createSseBroker(): SseBroker {
  // ponytail: in-process only — publishAccessInvalidation does not fan out via
  // Redis. Multi-replica deployments will not revoke SSE streams on other pods
  // (security control is single-node). Upgrade: Redis pub/sub on userAccessChannel.
  const channels = new Map<string, Map<string, SseClient>>();
  const accessInvalidationListeners = new Map<string, Map<string, () => void>>();

  function getOrCreateChannel(channel: string): Map<string, SseClient> {
    let clients = channels.get(channel);
    if (!clients) {
      clients = new Map();
      channels.set(channel, clients);
    }
    return clients;
  }

  return {
    addClient(channel, send, close) {
      const clientId = generateId();
      const clients = getOrCreateChannel(channel);
      clients.set(clientId, { id: clientId, send, close });
      return clientId;
    },

    removeClient(channel, clientId) {
      const clients = channels.get(channel);
      // skip: channel was never registered or already cleaned up
      if (!clients) return;
      clients.delete(clientId);
      if (clients.size === 0) channels.delete(channel);
    },

    pushToChannel(channel, event) {
      const clients = channels.get(channel);
      // skip: no listeners on this channel, event has no audience
      if (!clients) return;
      for (const client of clients.values()) {
        client.send(event);
      }
    },

    getClientCount(channel) {
      return channels.get(channel)?.size ?? 0;
    },

    getTotalClientCount() {
      let total = 0;
      for (const clients of channels.values()) {
        total += clients.size;
      }
      return total;
    },

    subscribeAccessInvalidation(userId, onInvalidate) {
      const channel = userAccessChannel(userId);
      const listenerId = generateId();
      let listeners = accessInvalidationListeners.get(channel);
      if (!listeners) {
        listeners = new Map();
        accessInvalidationListeners.set(channel, listeners);
      }
      listeners.set(listenerId, onInvalidate);
      return () => {
        const current = accessInvalidationListeners.get(channel);
        // skip: already unsubscribed (e.g. stream ended after a publish already fired)
        if (!current) return;
        current.delete(listenerId);
        if (current.size === 0) accessInvalidationListeners.delete(channel);
      };
    },

    publishAccessInvalidation(userId) {
      const channel = userAccessChannel(userId);
      const listeners = accessInvalidationListeners.get(channel);
      // skip: no live stream is watching this user right now
      if (!listeners) return;
      // Snapshot before iterating — a fired listener unsubscribes itself,
      // which would mutate `listeners` mid-iteration otherwise.
      for (const onInvalidate of [...listeners.values()]) {
        onInvalidate();
      }
    },
  };
}
