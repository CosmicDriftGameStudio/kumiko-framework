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
// **Tenant-Source V.1.1**: TreeContext.tenantId ist auf SYSTEM_TENANT_ID
// gepinnt. Provider die echten Tenant brauchen kommen V.1.2 (text-content)
// — dann wird der Tenant-Source via Auth-Layer / TenantContext / Prop
// verdrahtet. V.1.1 zeigt das Wiring durch, kein konkreter Tenant-Bedarf.
//
// Siehe visual-tree.md V.1.1-A.

import type {
  TenantId,
  TreeChildrenSubscribe,
  TreeContext,
  TreeNode,
} from "@cosmicdrift/kumiko-framework/engine";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useTreeProviders } from "../app/tree-providers-context";
import { TreeNodeRenderer } from "./tree-node-renderer";

const EXPANDED_STORAGE_PREFIX = "kumiko:visual-tree:expanded:";

// V.1.1-Pin: TenantId für die Default-Tree-Context. Lokal als Branded-
// Type-Construction (Memory `[Type Assertions]`) statt Value-Import aus
// /engine — der engine-Barrel ist `runtime`-klassifiziert und ein client-
// Modul darf ihn nicht als Wert konsumieren. **Sync-Pflicht**: muss mit
// SYSTEM_TENANT_ID aus engine/types/identifiers.ts identisch bleiben;
// ein Mismatch zeigt sich als „falscher Tenant" in Provider-Requests.
// V.1.2 ersetzt den Pin durch echten Tenant-Source (TenantContext oder
// Auth-Layer) sobald der erste Provider tenant-spezifische Daten braucht.
const SYSTEM_TENANT_ID_PIN = "00000000-0000-4000-8000-000000000000" as TenantId;

const DEFAULT_TREE_CTX: TreeContext = Object.freeze({ tenantId: SYSTEM_TENANT_ID_PIN });

export type VisualTreeProps = {
  /** Workspace-ID des aktiven `navigation:"tree"`-Workspaces. Wird als
   *  Schlüssel für localStorage-Persistenz verwendet (separates
   *  Expand-State pro Workspace, weil ein User mehrere Visual-Workspaces
   *  haben kann). */
  readonly workspaceId: string;
};

export function VisualTree({ workspaceId }: VisualTreeProps): ReactNode {
  const providers = useTreeProviders();
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

  return (
    <aside
      aria-label="Visual Tree"
      data-kumiko-layout="visual-tree"
      className="flex flex-col text-sm overflow-y-auto"
    >
      {sortedProviders.map(([featureName, provider]) => (
        <ProviderBranch
          key={featureName}
          featureName={featureName}
          provider={provider}
          ctx={DEFAULT_TREE_CTX}
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
function ProviderBranch({
  featureName,
  provider,
  ctx,
  expanded,
  onToggle,
}: {
  readonly featureName: string;
  readonly provider: TreeChildrenSubscribe;
  readonly ctx: TreeContext;
  readonly expanded: ReadonlySet<string>;
  readonly onToggle: (path: string) => void;
}): ReactNode {
  // null = noch nicht emitted (initial-Loading). Ein Provider der
  // niemals emittet bleibt damit sichtbar als „lädt …" und nicht
  // unsichtbar — Memory `[Sicherheit > Convenience]`.
  const [nodes, setNodes] = useState<readonly TreeNode[] | null>(null);

  useEffect(() => {
    // TODO V.1.2: Subscribe-Error-Handling. Drei Error-Surfaces sind heute
    // nicht abgedeckt: (1) provider(ctx) wirft synchron, (2) subscribe(emit)
    // wirft synchron, (3) Provider-internes SSE/fetch wirft → emit nie
    // gefeuert, „lädt …" bleibt unendlich. Fix-Shape hängt vom
    // V.1.2-Consumer (text-content) ab — transient-network-blip vs.
    // tenant-misconfig haben unterschiedliche Recovery-Pfade. Reload-
    // Action im Knoten (state="error" + retry-Button) als minimaler
    // Plan, aber ohne konkreten Failure-Mode-Anker keine richtige Spec.
    const subscribe = provider(ctx);
    const unsubscribe = subscribe(setNodes);
    return unsubscribe;
  }, [provider, ctx]);

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
            ctx={ctx}
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
