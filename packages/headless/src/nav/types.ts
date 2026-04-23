import type { NavDefinition } from "@kumiko/framework/ui-types";

// A single resolved nav entry as the renderer consumes it. Labels are NOT
// translated yet — nav can be used in SSR contexts where the locale isn't
// known at resolve time; the renderer runs `label` through
// LocaleResolver.translate() when it draws the sidebar/topbar item.
//
// Identity: `qualifiedName` is the same QN the registry uses
// ("{feature}:nav:{id}"). Renderers key off this for active-route tracking
// and for `parent` matching in screen extensions (M4).
export type NavNode = {
  readonly qualifiedName: string;
  readonly label: string;
  readonly icon?: string;
  readonly screen?: string;
  readonly order: number;
  readonly children: readonly NavNode[];
};

// The tree returned by resolveNavigation. Empty when the user can see no
// entries — renderer draws a fallback ("no navigation available" or just
// a blank sidebar, app decision).
export type NavTree = readonly NavNode[];

// Minimal registry surface resolveNavigation reads from. Deliberately
// narrower than the full Registry — keeps the resolver test-friendly
// (callers can stub with a two-field plain object) and pins the
// coupling to just the two index-accessors the resolver actually uses:
//
//   - `topLevel` : roots list (entries with no parent). Pre-grouped in
//                  the registry — resolver starts its walk here.
//   - `byParent` : O(1) children lookup by parent qualified name. The
//                  walk descends into this for each node; access-gating
//                  happens top-down, so a hidden parent implicitly
//                  hides the whole subtree.
//
// Note: the registry stores each NavDefinition with its `id` already
// qualified ("feature:nav:short"); resolveNavigation reads that directly.
//
// Production callers pass:
//   { topLevel: registry.getTopLevelNavs(),
//     byParent: (qn) => registry.getNavsByParent(qn) }
export type NavRegistrySlice = {
  readonly topLevel: readonly NavDefinition[];
  readonly byParent: (parentQualifiedName: string) => readonly NavDefinition[];
};

// Options passed to resolveNavigation.
export type ResolveNavigationOptions = {
  readonly source: NavRegistrySlice;
  // Current session user. Access-rule enforcement compares
  // rule.roles against user.roles. When user is undefined, ONLY
  // entries with access.openToAll === true (or no access declared)
  // survive — matches the "anonymous visit" semantic.
  readonly user?: {
    readonly id: string;
    readonly roles: readonly string[];
  };
};

export type { NavDefinition };
