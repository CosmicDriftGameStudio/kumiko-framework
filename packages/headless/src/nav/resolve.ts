import type { AccessRule, NavDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { NavNode, NavTree, ResolveNavigationOptions } from "./types";

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
    if (!userCanSee(entry.access, user)) return null;
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

// Access evaluator. Duplicated minimal logic instead of importing
// hasAccess from @cosmicdrift/kumiko-framework/engine at runtime — that module pulls
// in server-side deps (tenant-db, ownership-evaluator) and would break
// ui-core's bundle-purity guarantee. Only roles + openToAll are checked;
// ownership-level row-filtering is a server-side concern and doesn't
// apply to navigation entries (they're a menu, not a dataset).
function userCanSee(
  access: AccessRule | undefined,
  user: ResolveNavigationOptions["user"],
): boolean {
  // No rule = always visible — matches the framework's "engine stays
  // un-opinionated about who sees what" stance in the nav docs.
  if (!access) return true;
  if ("openToAll" in access && access.openToAll) return true;
  if (!user) return false; // anonymous can't match a role-gated rule
  if ("roles" in access) {
    const allowed = access.roles;
    for (const role of user.roles) {
      if (allowed.includes(role)) return true;
    }
  }
  return false;
}
