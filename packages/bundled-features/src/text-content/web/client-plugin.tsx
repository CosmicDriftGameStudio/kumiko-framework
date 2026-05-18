// @runtime client
// Client-Feature-Factory für text-content Visual-Tree. Wird vom App-Code
// in createKumikoApp({ clientFeatures: [textContentClient()] }) eingehängt
// und liefert den treeProvider der Text-Blocks aus der by-tenant Query
// lädt, nach Slug-Prefix gruppiert und als TreeNode[] emitted.
//
// **Slug-Gruppierung**: Slugs der Form `<prefix>:<rest>` oder `<prefix>/<rest>`
// werden unter einem `<prefix>`-Container-Knoten gruppiert. Slugs ohne
// Trenner landen als Top-Level-Knoten. Beispiele:
//   - "page:index:hero.title" → folder "page", label "index:hero.title"
//   - "imprint"               → root-node, label "imprint"
// V.1.3+ kann mehrstufige Hierarchien einführen wenn realer Bedarf zeigt.
//
// **State**: TreeNode.state = "filled" wenn body gesetzt ist, sonst
// "stub" (hellgrau, Designer-Hinweis dass Slug existiert aber leer ist).
//
// **Fetch statt Subscribe**: V.1.1 ist Fetch-once beim Mount. Unsubscribe
// ist no-op. V.1.3+ kann SSE-driven Re-Emit einbauen wenn text-block-
// updated-Events propagiert werden.

import { CSRF_HEADER_NAME, readCsrfToken } from "@cosmicdrift/kumiko-dispatcher-live";
import type {
  TargetRef,
  TreeChildrenSubscribe,
  TreeNode,
} from "@cosmicdrift/kumiko-framework/engine";
import { usePrimitives } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import type { ReactNode } from "react";
import { TextContentQueries } from "../constants";

type BlockSummary = {
  readonly slug: string;
  readonly lang: string;
  readonly title: string;
  readonly body: string | null;
  readonly updatedAt: string;
};

type ByTenantResponse = {
  readonly data: { readonly blocks: readonly BlockSummary[] };
};

// Folder-Name = alles vor dem ersten ":" oder "/", oder undefined wenn
// der Slug keinen Trenner enthält (dann landet er als Root-Node).
function getFolderName(slug: string): string | undefined {
  const sepIdx = slug.search(/[:/]/);
  if (sepIdx === -1) return undefined;
  return slug.slice(0, sepIdx);
}

function groupBlocksBySlugPrefix(blocks: readonly BlockSummary[]): readonly TreeNode[] {
  const rootNodes: TreeNode[] = [];
  const folders = new Map<string, TreeNode[]>();

  for (const block of blocks) {
    const node: TreeNode = {
      label: block.title || block.slug,
      target: {
        featureId: "text-content",
        action: "edit",
        args: { slug: block.slug, lang: block.lang },
      },
      state: block.body ? "filled" : "stub",
    };

    const folderName = getFolderName(block.slug);
    if (folderName === undefined) {
      rootNodes.push(node);
    } else {
      const existing = folders.get(folderName) ?? [];
      existing.push(node);
      folders.set(folderName, existing);
    }
  }

  for (const [name, children] of folders) {
    rootNodes.push({
      label: name,
      icon: "folder",
      state: "filled",
      children,
    });
  }

  return rootNodes;
}

const treeProvider: TreeChildrenSubscribe = () => (emit) => {
  // CSRF-Header bei authenticated requests pflicht (auth-middleware
  // double-submit pattern). Anonymous/Pre-Login wäre csrf-token=undefined
  // → header weggelassen → server lässt die anonymous-Variante durch.
  const headers: Record<string, string> = { "content-type": "application/json" };
  const csrf = readCsrfToken();
  if (csrf !== undefined) headers[CSRF_HEADER_NAME] = csrf;
  fetch("/api/query", {
    method: "POST",
    headers,
    body: JSON.stringify({
      type: TextContentQueries.byTenant,
      payload: {},
    }),
  })
    .then((r) => r.json())
    .then((data: ByTenantResponse) => {
      const nodes = groupBlocksBySlugPrefix(data.data.blocks);
      emit(nodes);
    })
    .catch(() => {
      // V.1.3+ TODO: state="error"-Knoten + Reload-Action statt empty.
      emit([]);
    });
  return () => {};
};

// Stub-Editor V.1.2 — zeigt slug/lang aus den TargetRef-args plus den
// V.1.3-TODO-Hinweis. Echte Edit-Form (title, body-textarea, save-button
// via TextContentHandlers.set) kommt in V.1.3 wenn der Resolver-Slot
// Form-Component-Pattern + dispatch-Wiring eingebaut hat. Bis dahin
// validiert der Stub das End-to-End-Wiring (TreeNode → buildTarget →
// dispatch → ResolversContext lookup → Render).
function TextContentEditor({
  target,
  onClose,
}: {
  readonly target: TargetRef;
  readonly onClose: () => void;
}): ReactNode {
  // @cast-boundary visual-tree-args — TargetRef.args ist erased zu
  // Record<string, unknown>; der Resolver kennt das Action-Shape (siehe
  // treeActions.edit-Definition unten) und de-erased pro Action analog
  // zu Event-Payloads. Optional-Chain absorbiert fehlende Felder ohne
  // throw, damit der Stub-Editor auch bei manuellem URL-Tampering nicht
  // crasht (TargetRef könnte aus old localStorage / URL-State stammen).
  const args = target.args as { slug?: string; lang?: string } | undefined;
  const { Button } = usePrimitives();
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold">Text-Block bearbeiten</h2>
          <p className="text-xs text-muted-foreground">
            {args?.slug ?? "—"} ({args?.lang ?? "—"})
          </p>
        </div>
        <Button variant="secondary" onClick={onClose}>
          schlie&szlig;en
        </Button>
      </header>
      <div className="flex-1 space-y-4 p-6 text-sm text-muted-foreground">
        <p>Editor-Stub (V.1.2). Echte Edit-Form folgt in V.1.3.</p>
        <pre className="rounded bg-muted p-2 text-xs">{JSON.stringify(target, null, 2)}</pre>
      </div>
    </div>
  );
}

export function textContentClient(): ClientFeatureDefinition {
  return {
    name: "text-content",
    treeProvider,
    treeActions: {
      edit: { args: { slug: "" as string, lang: "" as string } },
      list: {},
      create: { args: { folder: "" as string } },
    },
    resolvers: {
      "text-content:edit": TextContentEditor,
    },
  };
}
