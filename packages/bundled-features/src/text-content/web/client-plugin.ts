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

import type { TreeChildrenSubscribe, TreeNode } from "@cosmicdrift/kumiko-framework/engine";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
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

const treeProvider: TreeChildrenSubscribe = (_ctx) => (emit) => {
  fetch("/api/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
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

export function textContentClient(): ClientFeatureDefinition {
  return {
    name: "text-content",
    treeProvider,
    treeActions: {
      edit: { args: { slug: "" as string, lang: "" as string } },
      list: {},
      create: { args: { folder: "" as string } },
    },
  };
}
