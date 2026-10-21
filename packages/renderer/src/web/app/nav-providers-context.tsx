// NavProvidersContext — the client-side provider map for the single Nav. Unlike
// the old TreeProvidersContext (keyed by featureName, with one top-level branch
// per feature), these providers are keyed by a **Nav-QN**:
// a static r.nav node with `provider: true` gets its children at runtime from
// the registered TreeChildrenSubscribe. This lets a feature attach lazily to a
// specific Nav node (for example, "Content") instead of creating its own tree
// branch.
//
// `entities` (the parallel context) is the SSE entity list for each provider QN:
// NavTree subscribes via useLiveEvents and re-fires the provider on entity events,
// so newly created nodes appear live in the Nav.
//
// The default is empty maps (apps without dynamic Nav providers render only the
// static r.nav nodes). Aggregation occurs in create-app from clientFeatures.

import type { TreeChildrenSubscribe } from "@cosmicdrift/kumiko-framework/engine";
import { createContext, type ReactNode, useContext } from "react";

const EMPTY_PROVIDERS: ReadonlyMap<string, TreeChildrenSubscribe> = new Map();
const EMPTY_ENTITIES: ReadonlyMap<string, readonly string[]> = new Map();

const NavProvidersContext =
  createContext<ReadonlyMap<string, TreeChildrenSubscribe>>(EMPTY_PROVIDERS);
const NavEntitiesContext = createContext<ReadonlyMap<string, readonly string[]>>(EMPTY_ENTITIES);

export type NavProvidersProviderProps = {
  readonly value: ReadonlyMap<string, TreeChildrenSubscribe>;
  readonly entities?: ReadonlyMap<string, readonly string[]>;
  readonly children: ReactNode;
};

export function NavProvidersProvider({
  value,
  entities,
  children,
}: NavProvidersProviderProps): ReactNode {
  return (
    <NavProvidersContext.Provider value={value}>
      <NavEntitiesContext.Provider value={entities ?? EMPTY_ENTITIES}>
        {children}
      </NavEntitiesContext.Provider>
    </NavProvidersContext.Provider>
  );
}

/** Provider map keyed by Nav-QN. The empty-map default prevents crashes when
 *  no providers are registered. */
export function useNavProviders(): ReadonlyMap<string, TreeChildrenSubscribe> {
  return useContext(NavProvidersContext);
}

/** SSE entity list for each provider QN, used for live refresh. Empty-map default. */
export function useNavEntities(): ReadonlyMap<string, readonly string[]> {
  return useContext(NavEntitiesContext);
}
