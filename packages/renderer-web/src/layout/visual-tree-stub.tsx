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
// Siehe docs/plans/architecture/visual-tree.md A1 + Komponenten-
// Architektur-Sektion.

import type { ReactNode } from "react";

export function VisualTreeStub(): ReactNode {
  return (
    <aside
      aria-label="Visual Tree (V.1.1 placeholder)"
      style={{
        padding: "16px",
        fontSize: "13px",
        color: "var(--kumiko-text-muted, #888)",
      }}
    >
      <p style={{ margin: 0, fontWeight: 600 }}>Visual-Tree</p>
      <p style={{ marginTop: "8px" }}>
        Wird in <code>V.1.1</code> implementiert. Aktuell als Placeholder gemounted, weil dieser
        Workspace <code>navigation: "tree"</code> deklariert.
      </p>
    </aside>
  );
}
