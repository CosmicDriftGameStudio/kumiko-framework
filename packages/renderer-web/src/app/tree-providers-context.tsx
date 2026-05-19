// TreeProvidersContext — React-Context für die client-side TreeProvider-
// Map. Wird von createKumikoApp aus den `clientFeatures[].treeProvider`-
// Feldern aggregiert und steht damit allen Layout-Komponenten zur
// Verfügung (insbesondere VisualTree im WorkspaceShell).
//
// **Warum Context, nicht Prop**: WorkspaceShell ist bereits multi-Prop
// (brand, schema, user, sidebarFooter, ...). Provider-Map wäre der
// nächste Required-when-tree-mode-Prop und würde das Interface aufweichen
// (welche Props sind Pflicht wann?). Context-Pattern ist konsistent zu
// existing kumiko-renderer-Mechanik (NavProvider, LocaleProvider,
// PrimitivesProvider, LiveEventsProvider) — alle für „cross-component
// state aus app-level".
//
// **Default-Wert** ist eine leere Map. Apps ohne Tree-Workspace mounten
// die App ohne `clientFeatures` mit `treeProvider`, und VisualTree
// rendert eine empty-state-Sicht. Memory `[Sicherheit > Convenience]`:
// kein silent-fallback, sondern explicit empty.
//
// Siehe visual-tree.md V.1.1-Distribution-Mechanismus.

import type { TreeChildrenSubscribe } from "@cosmicdrift/kumiko-framework/engine";
import { createContext, type ReactNode, useContext } from "react";

const EMPTY_PROVIDERS: ReadonlyMap<string, TreeChildrenSubscribe> = new Map();
const EMPTY_ENTITIES: ReadonlyMap<string, readonly string[]> = new Map();

const TreeProvidersContext =
  createContext<ReadonlyMap<string, TreeChildrenSubscribe>>(EMPTY_PROVIDERS);

// V.1.5b separater Context für SSE-Entity-Lists pro Provider. Parallel-
// Context statt Entry-Tuple weil bestehende TreeProvidersProvider-Konsumenten
// (tests, integration) sonst alle Migrations-Effort hätten.
const TreeEntitiesContext = createContext<ReadonlyMap<string, readonly string[]>>(EMPTY_ENTITIES);

export type TreeProvidersProviderProps = {
  readonly value: ReadonlyMap<string, TreeChildrenSubscribe>;
  /** Optional: pro Provider die Entity-Liste für SSE-Live-Refresh.
   *  Default: leere Map → kein Provider refresht via SSE. */
  readonly entities?: ReadonlyMap<string, readonly string[]>;
  readonly children: ReactNode;
};

export function TreeProvidersProvider({
  value,
  entities,
  children,
}: TreeProvidersProviderProps): ReactNode {
  return (
    <TreeProvidersContext.Provider value={value}>
      <TreeEntitiesContext.Provider value={entities ?? EMPTY_ENTITIES}>
        {children}
      </TreeEntitiesContext.Provider>
    </TreeProvidersContext.Provider>
  );
}

/** Hook für TreeProvider-Map-Konsumenten (VisualTree im WorkspaceShell).
 *  Returnt eine empty Map wenn die App keine clientFeatures mit
 *  treeProvider registriert hat — sicheres Default-Verhalten ohne
 *  Crash. */
export function useTreeProviders(): ReadonlyMap<string, TreeChildrenSubscribe> {
  return useContext(TreeProvidersContext);
}

/** V.1.5b SSE-Entity-Map pro Provider. Empty Map default. */
export function useTreeEntities(): ReadonlyMap<string, readonly string[]> {
  return useContext(TreeEntitiesContext);
}
