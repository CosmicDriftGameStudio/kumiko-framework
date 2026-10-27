// Content tree behind the text-block and collection navs: loads the blocks from the
// by-tenant (or a collection's list) query, groups them by their `folder` field and
// emits them as TreeNode[].
//
// **Folder grouping**: block.folder !== null puts the node under a container
// node labelled with the folder; folder === null keeps it at the root.
//
// **State**: TreeNode.state = "filled" when content is set, otherwise "stub"
// (a hint that the slug exists but is empty).

import type { TreeChildrenSubscribe, TreeNode } from "@cosmicdrift/kumiko-framework/engine";
import { CSRF_HEADER_NAME, readCsrfToken } from "@cosmicdrift/kumiko-renderer/live";
import type { ContentCollectionSchema } from "./collection-lookup.ts";
import { collectionQueryName, TemplateResolverQueries } from "./qualified-names.ts";

export type BlockSummary = {
  readonly slug: string;
  readonly locale: string;
  readonly title: string | null;
  readonly content: string | null;
  readonly folder: string | null;
  readonly modifiedAt: string | null;
};

type ByTenantResponse = {
  readonly data: { readonly blocks: readonly BlockSummary[] };
};

// Multi-level folder splitting: `folder` is a `/`-separated path, the tree
// splits per segment and creates nested folder nodes:
//   block.folder = null              → root leaf
//   block.folder = "page"            → folder page > leaf
//   block.folder = "page/marketing"  → folder page > folder marketing > leaf
//
// **Folder/leaf collision**: a block with `folder=null, slug="page"` and
// another with `folder="page"` both live on the same level — the folder with
// children plus a clickable leaf. Visually distinct (chevron + folder icon),
// no crash, no surprise.

type FolderNode = {
  readonly leaves: TreeNode[];
  readonly subFolders: Map<string, FolderNode>;
};

function newFolderNode(): FolderNode {
  return { leaves: [], subFolders: new Map() };
}

function attachBlock(
  root: FolderNode,
  block: BlockSummary,
  tenantIdOverride?: string,
  collectionId?: string,
): void {
  const leaf: TreeNode = {
    label: block.title || block.slug,
    icon: "file",
    target: {
      featureId: "template-resolver",
      action: "edit",
      // tenantIdOverride and collectionId travel with the node → the editor
      // reads and writes through the same tenant and the same collection the
      // tree was loaded from. Omitted → session tenant, public text-blocks.
      args: {
        slug: block.slug,
        locale: block.locale,
        ...(tenantIdOverride !== undefined && { tenantIdOverride }),
        ...(collectionId !== undefined && { collectionId }),
      },
    },
    state: block.content ? "filled" : "stub",
  };
  if (block.folder === null) {
    root.leaves.push(leaf);
    return;
  }
  let cur = root;
  for (const segment of block.folder.split("/")) {
    let next = cur.subFolders.get(segment);
    if (next === undefined) {
      next = newFolderNode();
      cur.subFolders.set(segment, next);
    }
    cur = next;
  }
  cur.leaves.push(leaf);
}

function renderFolderNode(node: FolderNode): TreeNode[] {
  // Leaves first (root items), then folders alphabetically.
  const result: TreeNode[] = [...node.leaves];
  for (const folderName of [...node.subFolders.keys()].sort()) {
    const subNode = node.subFolders.get(folderName);
    if (subNode === undefined) continue;
    result.push({
      label: folderName,
      icon: "folder",
      state: "filled",
      children: renderFolderNode(subNode),
    });
  }
  return result;
}

export function groupBlocksByFolder(
  blocks: readonly BlockSummary[],
  tenantIdOverride?: string,
  collectionId?: string,
): readonly TreeNode[] {
  const root = newFolderNode();
  for (const block of blocks) {
    attachBlock(root, block, tenantIdOverride, collectionId);
  }
  const rendered = renderFolderNode(root);
  if (rendered.length === 0) return [];
  return [
    {
      label: "Content",
      icon: "folder",
      state: "filled",
      children: rendered,
    },
  ];
}

// A save in the editor re-fires the tree of the collection it wrote to. The
// SSE refresh does not cover every collection: per-user entries carry no
// entity signal, because naming their ids to every collection reader would
// reveal when colleagues change their own entries.
export const TEXT_BLOCK_TREE_KEY = "";
const treeRefreshListeners = new Map<string, Set<() => void>>();

function onTreeRefresh(treeKey: string, listener: () => void): () => void {
  const listeners = treeRefreshListeners.get(treeKey) ?? new Set();
  listeners.add(listener);
  treeRefreshListeners.set(treeKey, listeners);
  return () => listeners.delete(listener);
}

export function refreshTree(treeKey: string): void {
  for (const listener of treeRefreshListeners.get(treeKey) ?? []) listener();
}

type BlockListResult =
  | { readonly ok: true; readonly blocks: readonly BlockSummary[] }
  | { readonly ok: false; readonly status: number; readonly body: string };

async function postBlockList(
  queryType: string,
  tenantIdOverride: string | undefined,
): Promise<BlockListResult> {
  // CSRF header is mandatory on authenticated requests (auth-middleware
  // double-submit pattern). Anonymous/pre-login has no token → header
  // omitted → the server takes the anonymous path.
  const headers: Record<string, string> = { "content-type": "application/json" };
  const csrf = readCsrfToken();
  if (csrf !== undefined) headers[CSRF_HEADER_NAME] = csrf;
  // kumiko-lint-ignore no-raw-hooks not yet converted to the framework hook set
  const response = await fetch("/api/query", {
    method: "POST",
    headers,
    body: JSON.stringify({
      type: queryType,
      payload: tenantIdOverride !== undefined ? { tenantIdOverride } : {},
    }),
  });
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      body: await response.text().catch(() => response.statusText),
    };
  }
  const data: ByTenantResponse = await response.json();
  return { ok: true, blocks: data.data.blocks };
}

const TENANT_OVERRIDE_DENIED_REASON = "tenant_override_requires_system_admin";

// The dispatcher accepts tenantIdOverride from a SystemAdmin only, and the
// provider cannot see the session roles. Everyone else gets this exact denial
// and reads their session tenant instead, which is the only tenant they may
// edit anyway.
function isTenantOverrideDenied(result: BlockListResult): boolean {
  return !result.ok && result.status === 403 && result.body.includes(TENANT_OVERRIDE_DENIED_REASON);
}

async function loadBlocks(
  queryType: string,
  tenantIdOverride: string | undefined,
): Promise<{ readonly blocks: readonly BlockSummary[]; readonly tenantIdOverride?: string }> {
  let result = await postBlockList(queryType, tenantIdOverride);
  let effectiveOverride = tenantIdOverride;
  if (tenantIdOverride !== undefined && isTenantOverrideDenied(result)) {
    result = await postBlockList(queryType, undefined);
    effectiveOverride = undefined;
  }
  if (!result.ok) {
    // 403 (CSRF/auth) or 5xx — explicit error instead of silent empty.
    throw new Error(`text-block load failed: ${result.status} ${result.body}`);
  }
  return {
    blocks: result.blocks,
    ...(effectiveOverride !== undefined && { tenantIdOverride: effectiveOverride }),
  };
}

// tenantIdOverride (SystemAdmin-only) lets an app point the content tree at a
// tenant other than the session's — publicstatus seeds marketing/legal blocks
// on SYSTEM_TENANT_ID, so its SystemAdmin must read that tenant, not their own.
// Without a collection: the anonymous-capable by-tenant query, so a public
// page keeps its content sidebar without a session. With one: that
// collection's own list handler, which carries the collection's access rule.
export function makeTreeProvider(
  tenantIdOverride?: string,
  collection?: Pick<ContentCollectionSchema, "id" | "ownership">,
): TreeChildrenSubscribe {
  const collectionId = collection?.id;
  const queryType =
    collectionId === undefined
      ? TemplateResolverQueries.byTenant
      : collectionQueryName(collectionId, "list");
  // A per-user entry belongs to its author in the session tenant; pointing the
  // tree at another tenant would only hide the author's own entries.
  const requestedOverride = collection?.ownership === "user" ? undefined : tenantIdOverride;
  return () => (emit, emitError) => {
    let active = true;
    // Each denial logs a client-fault warning on the server, so a reload after a
    // save does not ask again once this subscription learned the answer.
    let override = requestedOverride;
    const load = (): void => {
      loadBlocks(queryType, override)
        .then(({ blocks, tenantIdOverride: effectiveOverride }) => {
          if (!active) return;
          override = effectiveOverride;
          // The app-side r.nav node IS the "Content" container → the provider's
          // children are the folders/leaves below it, not the wrapper.
          const content = groupBlocksByFolder(blocks, effectiveOverride, collectionId)[0];
          emit(content !== undefined && Array.isArray(content.children) ? content.children : []);
        })
        .catch((e) => {
          if (!active) return;
          // Explicit error signal via emitError; ProviderBranch shows a banner
          // plus retry. Falls back to emit([]) for consumers without emitError.
          if (emitError) {
            emitError(e instanceof Error ? e : new Error(String(e)));
          } else {
            emit([]);
          }
        });
    };
    load();
    const unsubscribe = onTreeRefresh(collectionId ?? TEXT_BLOCK_TREE_KEY, load);
    return () => {
      active = false;
      unsubscribe();
    };
  };
}
