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

// What a publish invalidates. "user" is the broadest (and the historical
// default — every scope narrower than this is an opt-in from a caller that
// knows exactly which credential(s) it revoked).
export type AccessInvalidationScope =
  | { readonly kind: "user" }
  | { readonly kind: "all-except-session"; readonly keptSessionId: string }
  | { readonly kind: "sessions"; readonly sessionIds: readonly string[] }
  | { readonly kind: "pat-tokens"; readonly tokenIds: readonly string[] };

// What a stream's own listener is authenticated as — used to decide whether
// a narrow scope (sessions/pat-tokens) applies to it. A listener with
// neither field (should not normally happen — dispatch-stream.ts always
// passes at least one) is treated as unidentifiable and closed by every
// narrow scope, same fail-closed stance as a PAT stream facing a
// sessions-scope.
export type AccessInvalidationCredential = {
  readonly sid?: string;
  readonly patTokenId?: string;
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
    credential?: AccessInvalidationCredential,
  ): () => void;
  // `scope` narrows which credential(s) close; omitted = userwide (every
  // listener), the historical default and still what unrelated
  // reasons (role change, membership removal) use.
  publishAccessInvalidation(userId: string, scope?: AccessInvalidationScope): void;
};

// Fail-closed: a narrow scope only spares/limits a listener it can positively
// match against its own credential. A listener with neither sid nor
// patTokenId of its own can't be matched by "sessions"/"pat-tokens", so it
// closes — same reasoning "all-except-session" already used for a sidless
// (PAT/bearer) listener.
export function shouldInvalidateListener(
  credential: AccessInvalidationCredential,
  scope: AccessInvalidationScope,
): boolean {
  switch (scope.kind) {
    case "user":
      return true;
    case "all-except-session":
      return credential.sid !== scope.keptSessionId;
    case "sessions":
      return credential.sid !== undefined
        ? scope.sessionIds.includes(credential.sid)
        : credential.patTokenId === undefined;
    case "pat-tokens":
      return credential.patTokenId !== undefined
        ? scope.tokenIds.includes(credential.patTokenId)
        : credential.sid === undefined;
  }
}

export function createSseBroker(): SseBroker {
  // Purely local: no cross-replica fanout. buildServer wraps this in
  // createRedisSseBroker (fw#2625) whenever REDIS_URL is set, which is what
  // makes pushToChannel/publishAccessInvalidation reach every replica's
  // clients — this reference implementation stays single-process only.
  const channels = new Map<string, Map<string, SseClient>>();
  // Keyed by callback reference, value is the subscriber's own credential.
  // Every subscriber must pass a distinct closure (dispatch-stream.ts does,
  // one per stream). Two subscribes with the SAME reference for the same
  // user collapse into one listener, and the first unsubscribe kills both.
  const accessInvalidationListeners = new Map<
    string,
    Map<() => void, AccessInvalidationCredential>
  >();

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

    subscribeAccessInvalidation(userId, onInvalidate, credential) {
      const channel = userAccessChannel(userId);
      let listeners = accessInvalidationListeners.get(channel);
      if (!listeners) {
        listeners = new Map();
        accessInvalidationListeners.set(channel, listeners);
      }
      listeners.set(onInvalidate, credential ?? {});
      return () => {
        const current = accessInvalidationListeners.get(channel);
        // skip: already unsubscribed (e.g. stream ended after a publish already fired)
        if (!current) return;
        current.delete(onInvalidate);
        if (current.size === 0) accessInvalidationListeners.delete(channel);
      };
    },

    publishAccessInvalidation(userId, scope) {
      const channel = userAccessChannel(userId);
      const listeners = accessInvalidationListeners.get(channel);
      // skip: no live stream is watching this user right now
      if (!listeners) return;
      const resolvedScope: AccessInvalidationScope = scope ?? { kind: "user" };
      // Snapshot before iterating — a fired listener unsubscribes itself,
      // which would mutate `listeners` mid-iteration otherwise.
      for (const [onInvalidate, credential] of [...listeners]) {
        if (!shouldInvalidateListener(credential, resolvedScope)) continue;
        onInvalidate();
      }
    },
  };
}
