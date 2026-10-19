// NavProvidersContext — client-side Provider-Map für die EINE Nav. Anders
// als der alte TreeProvidersContext (keyed auf featureName, ein Top-Level-
// Branch pro Feature) sind diese Provider auf eine **Nav-QN** geschlüsselt:
// ein statischer r.nav-Knoten mit `provider: true` bekommt seine Children
// zur Laufzeit aus dem hier registrierten TreeChildrenSubscribe. So hängt
// sich ein Feature lazy an einen konkreten Nav-Knoten (z.B. "Content") statt
// einen eigenen Tree-Branch aufzumachen.
//
// `entities` (parallel-Context) ist die SSE-Entity-Liste pro Provider-QN:
// NavTree abonniert sie via useLiveEvents und re-fired den Provider bei
// Entity-Events — dadurch erscheinen neu erstellte Knoten live in der Nav.
//
// Default = leere Maps (Apps ohne dynamische Nav-Provider rendern nur die
// statischen r.nav-Knoten). Aggregiert wird in create-app aus den
// clientFeatures.

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

/** Provider-Map keyed auf Nav-QN. Empty-Map-Default → kein Crash ohne
 *  registrierte Provider. */
export function useNavProviders(): ReadonlyMap<string, TreeChildrenSubscribe> {
  return useContext(NavProvidersContext);
}

/** SSE-Entity-Liste pro Provider-QN für Live-Refresh. Empty-Map-Default. */
export function useNavEntities(): ReadonlyMap<string, readonly string[]> {
  return useContext(NavEntitiesContext);
}
