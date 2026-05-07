// VisualTreeStub — Phase-0-Schicht-3-Placeholder für den Visual-Tree-
// Sidebar in `r.workspace({ navigation: "tree" })`-Workspaces.
//
// **Was er ersetzt.** Die echte Visual-Tree-Component (Subscribe-
// Wiring, Provider-Iteration, polymorphic editTarget-Routing) kommt
// in V.1.1. Bis dahin: jeder Workspace mit `navigation: "tree"` mountet
// diesen Stub statt des hardcoded NavTree, sodass Phase 0 Schicht 1+2
// (typed buildTarget, r.treeActions, r.tree, Registry.getTreeProviders)
// einen Konsumenten haben — ohne dass die UI-Schicht schon steht.
//
// **Warum Stub statt nichts.** Plan-File V.1 sagt: Phase 0 ist „Stub-
// Implementierung von WorkspaceShell-Switch". Heißt: das navigation-
// Property muss schon zur Mount-Zeit greifen, sonst kann V.1.1 nicht
// gegen ein lebendes opt-in-Pattern bauen. Der Stub ist die minimale
// Form die das beweist.
//
// **Styling.** Tailwind-Klassen konsistent mit existing layout-Komponenten
// (Sidebar nutzt `bg-muted/30 text-sm`, NavTree nutzt `cn`-Helper).
// V.1.1-Visual-Tree-Component sollte diese Convention fortführen.
//
// Siehe docs/plans/architecture/visual-tree.md A1 + Komponenten-
// Architektur-Sektion.

import type { ReactNode } from "react";

export function VisualTreeStub(): ReactNode {
  return (
    <aside
      aria-label="Visual Tree (V.1.1 placeholder)"
      data-kumiko-layout="visual-tree-stub"
      className="p-4 text-sm text-muted-foreground"
    >
      <p className="m-0 font-semibold">Visual-Tree</p>
      <p className="mt-2">
        Wird in <code>V.1.1</code> implementiert. Aktuell als Placeholder gemounted, weil dieser
        Workspace <code>navigation: "tree"</code> deklariert.
      </p>
    </aside>
  );
}
