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
  // Separate from addClient so it doesn't count towards getClientCount.
  // Required (fw#1601): an app-injected SseBroker (e.g. a Redis-backed
  // multi-replica broker) that skips these silently turns the mid-stream
  // access-teardown security control (#1561) into a no-op — a revoked
  // session keeps receiving live SSE data with no error or log. A no-op
  // stub is one line for a broker that genuinely doesn't need it.
  subscribeAccessInvalidation(
    userId: string,
    onInvalidate: () => void,
    ownSid?: string,
  ): () => void;
  // `keptSessionId` spares exactly one stream: the caller's own session on a
  // "revoke all others" write. It is a keep-list, not a list of revoked
  // sessions, so a stream of a session already revoked without an event
  // (plain logout) still closes. Every other reason stays userwide.
  publishAccessInvalidation(userId: string, keptSessionId?: string): void;
};

// Fail-closed: without a kept sid, or for a listener without its own sid
// (PAT/bearer), nothing is spared.
function isSparedByKeptSessionId(
  ownSid: string | undefined,
  keptSessionId: string | undefined,
): boolean {
  return keptSessionId !== undefined && ownSid === keptSessionId;
}

export function createSseBroker(): SseBroker {
  // Purely local: no cross-replica fanout. buildServer wraps this in
  // createRedisSseBroker (fw#2625) whenever REDIS_URL is set, which is what
  // makes pushToChannel/publishAccessInvalidation reach every replica's
  // clients — this reference implementation stays single-process only.
  const channels = new Map<string, Map<string, SseClient>>();
  // Keyed by callback reference, value is the subscriber's own sid. Every
  // subscriber must pass a distinct closure (dispatch-stream.ts does, one per
  // stream). Two subscribes with the SAME reference for the same user
  // collapse into one listener, and the first unsubscribe kills both.
  const accessInvalidationListeners = new Map<string, Map<() => void, string | undefined>>();

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

    subscribeAccessInvalidation(userId, onInvalidate, ownSid) {
      const channel = userAccessChannel(userId);
      let listeners = accessInvalidationListeners.get(channel);
      if (!listeners) {
        listeners = new Map();
        accessInvalidationListeners.set(channel, listeners);
      }
      listeners.set(onInvalidate, ownSid);
      return () => {
        const current = accessInvalidationListeners.get(channel);
        // skip: already unsubscribed (e.g. stream ended after a publish already fired)
        if (!current) return;
        current.delete(onInvalidate);
        if (current.size === 0) accessInvalidationListeners.delete(channel);
      };
    },

    publishAccessInvalidation(userId, keptSessionId) {
      const channel = userAccessChannel(userId);
      const listeners = accessInvalidationListeners.get(channel);
      // skip: no live stream is watching this user right now
      if (!listeners) return;
      // Snapshot before iterating — a fired listener unsubscribes itself,
      // which would mutate `listeners` mid-iteration otherwise.
      for (const [onInvalidate, ownSid] of [...listeners]) {
        if (isSparedByKeptSessionId(ownSid, keptSessionId)) continue;
        onInvalidate();
      }
    },
  };
}
