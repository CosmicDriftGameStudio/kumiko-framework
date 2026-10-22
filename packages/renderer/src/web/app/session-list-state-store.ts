import type { ListStateStore } from "../../components/list-state-store.tsx";
import { getDefaultMemoryListStateStore } from "../../components/list-state-store.tsx";
import { parseStoredListStateJson } from "../../hooks/list-state-schema.ts";

const KEY_PREFIX = "kumiko.list.";
const IDENTITY_KEY = `${KEY_PREFIX}identity`;
const NO_TENANT = "-";

export type ListStateIdentity = {
  readonly userId: string;
  readonly tenantId?: string | undefined;
};

function identityMarker(identity: ListStateIdentity): string {
  return `${identity.tenantId ?? NO_TENANT}.${identity.userId}`;
}

function openSessionStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
  } catch {
    // Access itself throws when storage is blocked (privacy modes, sandboxed frames).
    return undefined;
  }
}

function prefixedKeys(storage: Storage): string[] {
  return Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
    (key): key is string => key !== null && key.startsWith(KEY_PREFIX),
  );
}

function removeAllRemembered(storage: Storage): void {
  for (const key of prefixedKeys(storage)) storage.removeItem(key);
}

/** Remembered list state for the lifetime of the browser tab, keyed per tenant
 *  and user. Every storage failure (blocked, full) degrades to "nothing remembered". */
export function createSessionListStateStore(
  storage: Storage,
  identity: ListStateIdentity,
): ListStateStore {
  const keyPrefix = `${KEY_PREFIX}${identityMarker(identity)}.`;
  return {
    read: (key) => {
      try {
        const raw = storage.getItem(`${keyPrefix}${key}`);
        return raw === null ? undefined : parseStoredListStateJson(raw);
      } catch {
        return undefined;
      }
    },
    write: (key, state) => {
      try {
        storage.setItem(`${keyPrefix}${key}`, JSON.stringify(state));
      } catch {
        // Quota or blocked storage: the list keeps working, it just is not remembered.
      }
    },
    remove: (key) => {
      try {
        storage.removeItem(`${keyPrefix}${key}`);
      } catch {
        // See write.
      }
    },
    clear: () => {
      try {
        for (const key of prefixedKeys(storage).filter((k) => k !== IDENTITY_KEY)) {
          storage.removeItem(key);
        }
      } catch {
        // See write.
      }
    },
  };
}

/** Forgets all remembered list state and the identity marker. Logout calls it
 *  before a page reload, which would otherwise hide the identity change. */
export function clearRememberedListState(): void {
  getDefaultMemoryListStateStore().clear();
  lastMemoryIdentity = undefined;
  const storage = openSessionStorage();
  // skip: no sessionStorage available, memory store already cleared
  if (storage === undefined) return;
  try {
    removeAllRemembered(storage);
  } catch {
    // See createSessionListStateStore.
  }
}

// The in-memory store survives SPA identity changes, so it needs its own marker.
let lastMemoryIdentity: string | undefined;

/** The store for the current identity. State remembered under another identity,
 *  or under one that has since gone away, is dropped first. Without an identity
 *  (app without auth) only the in-memory store is used and nothing is persisted. */
export function resolveListStateStore(identity: ListStateIdentity | undefined): ListStateStore {
  const storage = openSessionStorage();
  const memory = getDefaultMemoryListStateStore();
  const marker = identity === undefined ? undefined : identityMarker(identity);

  if (lastMemoryIdentity !== marker) {
    if (lastMemoryIdentity !== undefined) memory.clear();
    lastMemoryIdentity = marker;
  }

  if (storage === undefined) return memory;
  try {
    const storedMarker = storage.getItem(IDENTITY_KEY);
    if (marker === undefined) {
      if (storedMarker !== null) {
        removeAllRemembered(storage);
        memory.clear();
      }
      return memory;
    }
    if (storedMarker !== marker) {
      removeAllRemembered(storage);
      storage.setItem(IDENTITY_KEY, marker);
    }
  } catch {
    return memory;
  }
  return identity === undefined ? memory : createSessionListStateStore(storage, identity);
}
