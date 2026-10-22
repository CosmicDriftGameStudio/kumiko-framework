import { createContext, type ReactNode, useContext } from "react";
import type { StoredListState } from "../hooks/list-state-schema.ts";

export type ListStateStore = {
  read(key: string): StoredListState | undefined;
  write(key: string, state: StoredListState): void;
  remove(key: string): void;
  clear(): void;
};

export function createMemoryListStateStore(): ListStateStore {
  const entries = new Map<string, StoredListState>();
  return {
    read: (key) => entries.get(key),
    write: (key, state) => {
      entries.set(key, state);
    },
    remove: (key) => {
      entries.delete(key);
    },
    clear: () => {
      entries.clear();
    },
  };
}

// Module-wide so remembered list state survives route changes in the SPA
// without any provider mounted.
const defaultMemoryStore = createMemoryListStateStore();

const ListStateStoreContext = createContext<ListStateStore>(defaultMemoryStore);

export function ListStateStoreProvider({
  store,
  children,
}: {
  readonly store: ListStateStore;
  readonly children: ReactNode;
}): ReactNode {
  return <ListStateStoreContext.Provider value={store}>{children}</ListStateStoreContext.Provider>;
}

export function useListStateStore(): ListStateStore {
  return useContext(ListStateStoreContext);
}

/** The shared in-memory default; the web boot clears it when the identity changes. */
export function getDefaultMemoryListStateStore(): ListStateStore {
  return defaultMemoryStore;
}
