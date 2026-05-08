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

const TreeProvidersContext =
  createContext<ReadonlyMap<string, TreeChildrenSubscribe>>(EMPTY_PROVIDERS);

export type TreeProvidersProviderProps = {
  readonly value: ReadonlyMap<string, TreeChildrenSubscribe>;
  readonly children: ReactNode;
};

export function TreeProvidersProvider({ value, children }: TreeProvidersProviderProps): ReactNode {
  return <TreeProvidersContext.Provider value={value}>{children}</TreeProvidersContext.Provider>;
}

/** Hook für TreeProvider-Map-Konsumenten (VisualTree im WorkspaceShell).
 *  Returnt eine empty Map wenn die App keine clientFeatures mit
 *  treeProvider registriert hat — sicheres Default-Verhalten ohne
 *  Crash. */
export function useTreeProviders(): ReadonlyMap<string, TreeChildrenSubscribe> {
  return useContext(TreeProvidersContext);
}
