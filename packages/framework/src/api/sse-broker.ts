import { v4 as uuid } from "uuid";

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
};

export function createSseBroker(): SseBroker {
  const channels = new Map<string, Map<string, SseClient>>();

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
      const clientId = uuid();
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
  };
}
