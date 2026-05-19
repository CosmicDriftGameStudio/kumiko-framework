// @runtime client
// VisualTree — Top-Level-Component für `r.workspace({ navigation: "tree" })`-
// Workspaces. Ersetzt VisualTreeStub aus Phase 0 Schicht 3.
//
// **Pflichten** (visual-tree.md V.1.1-A):
//   1. Provider-Iteration via `useTreeProviders()`-Hook
//   2. Subscribe-Wiring pro Provider mit unsubscribe-Cleanup beim Unmount
//   3. Top-Level-Reihenfolge alphabetisch nach featureName
//   4. Children-Lazy-Load (TreeNodeRenderer subscribed wenn Knoten ausgeklappt)
//   5. localStorage-Persistenz für expanded-Set pro Workspace
//
// **Empty-State**: keine Provider registriert → Hint statt leerem
// `<aside>` (Memory `[Sicherheit > Convenience]`: explicit empty statt
// silent fallback). Apps die navigation:"tree" deklarieren aber keinen
// clientFeatures.treeProvider liefern, kriegen eine sichtbare Diagnose.
//
// **Tenant-Source**: Provider sind session-bound; Backend liest tenantId
// aus session bei jedem fetch/dispatch. V.1.1 hatte ein TreeContext-Arg
// mit hardcoded pinned tenantId, das vom einzigen Consumer (text-content)
// ignoriert wurde. SR2-Rip 2026-05-18: Dead-API entfernt. Tenant-aware
// Provider re-introduce wenn realer Bedarf (siehe tree-node.ts comment).
//
// Siehe visual-tree.md V.1.1-A.

import type { TreeChildrenSubscribe, TreeNode } from "@cosmicdrift/kumiko-framework/engine";
import { useLiveEvents } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useTreeEntities, useTreeProviders } from "../app/tree-providers-context";
import { TreeNodeRenderer } from "./tree-node-renderer";

const EXPANDED_STORAGE_PREFIX = "kumiko:visual-tree:expanded:";

// Stable-reference empty-list — vermeidet useEffect-deps-Trigger durch
// jedes Render (sonst würde `[].length === 0` short-circuit doch der
// Identity-Vergleich subscribeLive-effect destabilisieren).
const EMPTY_ENTITY_LIST: readonly string[] = [];

export type VisualTreeProps = {
  /** Workspace-ID des aktiven `navigation:"tree"`-Workspaces. Wird als
   *  Schlüssel für localStorage-Persistenz verwendet (separates
   *  Expand-State pro Workspace, weil ein User mehrere Visual-Workspaces
   *  haben kann). */
  readonly workspaceId: string;
};

export function VisualTree({ workspaceId }: VisualTreeProps): ReactNode {
  const providers = useTreeProviders();
  const treeEntities = useTreeEntities();
  const sortedProviders = useMemo(
    () => [...providers.entries()].sort(([a], [b]) => a.localeCompare(b)),
    [providers],
  );

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => loadExpanded(workspaceId));

  // localStorage-Persistenz: jeder Toggle persistiert sofort. Workspace-
  // Switch lädt anderen Set neu (siehe 2nd useEffect).
  useEffect(() => {
    saveExpanded(workspaceId, expanded);
  }, [workspaceId, expanded]);

  // Workspace-Switch: expanded-Set neu laden (User hat anderen Tree-
  // Workspace ausgewählt, dort gilt anderer Set).
  useEffect(() => {
    setExpanded(loadExpanded(workspaceId));
  }, [workspaceId]);

  const handleToggle = (path: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  if (sortedProviders.length === 0) {
    return <EmptyState />;
  }

  // V.1.5a ARIA-Tree-Keyboard-Nav: arrow-keys navigieren zwischen
  // sichtbaren treeitems via DOM-query (Source of Truth = was im DOM
  // sichtbar ist, inkl. expand/collapse-State). Tab kommt aus dem Tree
  // heraus (kein Trap); innerhalb wird Arrow-Key erwartet.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>): void => {
    const target = e.target as HTMLElement;
    if (target.getAttribute("role") !== "treeitem") return;

    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]'));
    const idx = items.indexOf(target);
    if (idx < 0) return;
    const path = target.dataset["kumikoTreePath"];
    const hasChildren = target.dataset["kumikoTreeHasChildren"] === "true";
    const isExpanded = target.getAttribute("aria-expanded") === "true";

    switch (e.key) {
      case "ArrowDown": {
        if (idx < items.length - 1) {
          e.preventDefault();
          items[idx + 1]?.focus();
        }
        break;
      }
      case "ArrowUp": {
        if (idx > 0) {
          e.preventDefault();
          items[idx - 1]?.focus();
        }
        break;
      }
      case "ArrowRight": {
        if (hasChildren && !isExpanded && path !== undefined) {
          e.preventDefault();
          handleToggle(path);
        } else if (hasChildren && isExpanded && idx < items.length - 1) {
          // Already expanded → move to first child (next visible item
          // ist by DOM-order der erste child).
          e.preventDefault();
          items[idx + 1]?.focus();
        }
        break;
      }
      case "ArrowLeft": {
        if (hasChildren && isExpanded && path !== undefined) {
          e.preventDefault();
          handleToggle(path);
        }
        // V.1.5a: kein parent-jump (würde flat-list-traversal brauchen,
        // ARIA-Tree-Pattern would expect that — geht V.1.5b mit roving-
        // tabindex). Aktuell ArrowLeft auf collapsed-item: no-op.
        break;
      }
      case "Home": {
        e.preventDefault();
        items[0]?.focus();
        break;
      }
      case "End": {
        e.preventDefault();
        items[items.length - 1]?.focus();
        break;
      }
    }
  };

  return (
    <aside
      aria-label="Visual Tree"
      data-kumiko-layout="visual-tree"
      className="flex flex-col text-sm overflow-y-auto"
      // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: ARIA-tree pattern requires role=tree on container; <aside> is the right semantic outer element for a sidebar
      role="tree"
      onKeyDown={handleKeyDown}
    >
      {sortedProviders.map(([featureName, provider]) => (
        <ProviderBranch
          key={featureName}
          featureName={featureName}
          provider={provider}
          entities={treeEntities.get(featureName) ?? EMPTY_ENTITY_LIST}
          expanded={expanded}
          onToggle={handleToggle}
        />
      ))}
    </aside>
  );
}

// ProviderBranch — eine Sub-Section pro registrertem TreeProvider.
// Jeder Provider liefert eine readonly TreeNode[] über Subscribe; jeder
// Top-Level-Knoten wird via TreeNodeRenderer gerendert.
//
// **V.1.4 Subscribe-Error-Handling**: drei Error-Surfaces sind abgedeckt:
//   1. provider() throws synchron → try/catch im useEffect setzt error
//   2. subscribe(emit) throws synchron → same try/catch
//   3. Provider-interner SSE/fetch fail't async → Provider muss
//      `emit({ error: ... })` rufen statt empty-emit. Heutige Convention:
//      Provider können einen Marker-TreeNode mit state="error" emitten
//      (siehe text-content client-plugin: catch + emit([])). Recovery-
//      Pfad ist Retry-Button im error-banner, der `attempt` increments
//      → useEffect re-fires (deps haben attempt drin) → provider neu
//      aufgerufen.
function ProviderBranch({
  featureName,
  provider,
  entities,
  expanded,
  onToggle,
}: {
  readonly featureName: string;
  readonly provider: TreeChildrenSubscribe;
  readonly entities: readonly string[];
  readonly expanded: ReadonlySet<string>;
  readonly onToggle: (path: string) => void;
}): ReactNode {
  // null = noch nicht emitted (initial-Loading). Ein Provider der
  // niemals emittet bleibt damit sichtbar als „lädt …" und nicht
  // unsichtbar — Memory `[Sicherheit > Convenience]`.
  const [nodes, setNodes] = useState<readonly TreeNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // V.1.5b SSE-Tree-Refresh: subscribe live-events für die gelisteten
  // entities, increment attempt → useEffect re-fires → provider re-mountet.
  // Gleiche Mechanik wie der retry-button, daher single trigger.
  const subscribeLive = useLiveEvents();
  useEffect(() => {
    if (entities.length === 0) return;
    const unsubs = entities.map((entityName) =>
      subscribeLive(entityName, () => setAttempt((n) => n + 1)),
    );
    return () => {
      for (const u of unsubs) u();
    };
  }, [entities, subscribeLive]);

  // `attempt` ist absichtlich in den deps: Retry-Button increments
  // attempt → useEffect re-fires → provider neu aufgerufen. Biome's
  // static-analysis sieht attempt nicht im body und meldet es als
  // unnecessary — semantisch ist es der Trigger.
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt triggers retry
  useEffect(() => {
    setError(null);
    setNodes(null);
    try {
      const subscribe = provider();
      try {
        const unsubscribe = subscribe(setNodes, (e) =>
          setError(e instanceof Error ? e.message : String(e)),
        );
        return unsubscribe;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Subscribe fehlgeschlagen.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Provider-Init fehlgeschlagen.");
    }
    return undefined;
  }, [provider, attempt]);

  if (error !== null) {
    return (
      <div
        data-kumiko-tree-branch={featureName}
        data-kumiko-tree-state="error"
        className="flex items-center gap-2 px-2 py-1 text-xs text-destructive"
      >
        <span className="flex-1">
          {featureName}: {error}
        </span>
        <button
          type="button"
          onClick={() => setAttempt((n) => n + 1)}
          className="rounded border border-destructive/40 px-2 py-0.5 hover:bg-destructive/10"
        >
          Neu laden
        </button>
      </div>
    );
  }

  if (nodes === null) {
    return (
      <div
        data-kumiko-tree-branch={featureName}
        data-kumiko-tree-state="loading"
        className="text-xs text-muted-foreground italic px-2 py-1"
      >
        {featureName}: lädt …
      </div>
    );
  }

  return (
    <div data-kumiko-tree-branch={featureName}>
      {nodes.map((node, idx) => {
        // Selbe idx-Disambiguator-Logik wie TreeNodeRenderer.ChildrenView.
        const nodePath = `${featureName}/${idx}-${node.label}`;
        return (
          <TreeNodeRenderer
            key={nodePath}
            node={node}
            path={nodePath}
            expanded={expanded}
            onToggle={onToggle}
            depth={0}
          />
        );
      })}
    </div>
  );
}

function EmptyState(): ReactNode {
  // <section> + aria-label + tabIndex=0 macht den Empty-State per Tab
  // erreichbar — sonst wäre die Diagnose-Message für Keyboard-Nutzer
  // unsichtbar/nicht-fokussierbar. <section> ist semantisch korrekt für
  // „informational region", Biome akzeptiert tabIndex hier (im Gegensatz
  // zu <aside> oder bare <div role="region">).
  // TODO V.1.2: Volle Arrow-Key-Navigation zwischen Tree-Siblings (siehe
  // ARIA-tree-Pattern). Heute nur Tab-Reach + native button-Tastatur.
  return (
    <section
      aria-label="Visual Tree (no providers)"
      data-kumiko-layout="visual-tree-empty"
      className="p-4 text-sm text-muted-foreground"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Empty-State ist eine Diagnose-Region die Keyboard-Nutzer per Tab erreichen können müssen
      tabIndex={0}
    >
      <p className="m-0 font-semibold">Keine Tree-Provider aktiv</p>
      <p className="mt-2">
        Dieser Workspace deklariert <code>navigation: "tree"</code>, aber kein registriertes
        Client-Feature liefert einen <code>treeProvider</code>. Siehe{" "}
        <code>
          createKumikoApp({"{"}clientFeatures: [...]{"}"})
        </code>
        .
      </p>
    </section>
  );
}

// localStorage-Helpers. Stille Failure bei Storage-Errors (Quota,
// Privacy-Mode) — Tree funktioniert dann ohne Persistenz, was ok ist.

function storageKey(workspaceId: string): string {
  return `${EXPANDED_STORAGE_PREFIX}${workspaceId}`;
}

function loadExpanded(workspaceId: string): ReadonlySet<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(storageKey(workspaceId));
    if (raw === null) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((p): p is string => typeof p === "string"));
  } catch {
    return new Set();
  }
}

function saveExpanded(workspaceId: string, expanded: ReadonlySet<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(workspaceId), JSON.stringify([...expanded]));
  } catch {
    // Privacy-Mode / Quota-Errors → ignorieren, Tree läuft ohne
    // Persistenz weiter.
  }
}
