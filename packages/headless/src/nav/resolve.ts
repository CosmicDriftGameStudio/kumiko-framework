import type { NavDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { isUiAccessGranted } from "@cosmicdrift/kumiko-framework/ui-types";
import type { NavNode, NavTree, ResolveNavigationOptions } from "./types.js";

// Assembles the renderable nav tree from the registry's pre-grouped
// indexes (topLevel + byParent). Walks top-down: each node is
// access-checked; a hidden parent drops its entire subtree implicitly
// because we never recurse into it. Siblings sort by `order` (ascending,
// default 0), tie-broken by qualified name so renders stay deterministic
// across registry iteration orders.
//
// Pure — same inputs produce the same tree. The renderer memoizes the
// result and only recomputes when the registry changes (rare — boot
// only) or the user's roles change (logout/login, tenant-switch).
export function resolveNavigation(options: ResolveNavigationOptions): NavTree {
  const { source, user } = options;

  function build(entry: NavDefinition): NavNode | null {
    // Shared default-visible UI predicate, not hasAccess from the engine:
    // that module pulls server-side deps and would break bundle purity.
    if (!isUiAccessGranted(entry.access, user?.roles)) return null;
    // `entry.id` is already the qualified name — the registry stores
    // it that way. No reverse-index lookup needed.
    const children: NavNode[] = [];
    for (const child of source.byParent(entry.id)) {
      const node = build(child);
      if (node !== null) children.push(node);
    }
    children.sort(bySortKey);
    return {
      qualifiedName: entry.id,
      label: entry.label,
      order: entry.order ?? 0,
      children,
      ...(entry.icon !== undefined && { icon: entry.icon }),
      ...(entry.screen !== undefined && { screen: entry.screen }),
      ...(entry.target !== undefined && { target: entry.target }),
      ...(entry.actions !== undefined && { actions: entry.actions }),
      ...(entry.createAction !== undefined && { createAction: entry.createAction }),
      ...(entry.provider !== undefined && { provider: entry.provider }),
    };
  }

  const roots: NavNode[] = [];
  for (const entry of source.topLevel) {
    const node = build(entry);
    if (node !== null) roots.push(node);
  }
  roots.sort(bySortKey);
  return roots;
}

function bySortKey(a: NavNode, b: NavNode): number {
  // Primary key: `order` ascending. Secondary: qualifiedName alphabetic,
  // which is a stable fallback — the registry-iteration order isn't
  // guaranteed across boots, so tied-order entries would otherwise
  // shuffle between renders.
  if (a.order !== b.order) return a.order - b.order;
  return a.qualifiedName.localeCompare(b.qualifiedName);
}
