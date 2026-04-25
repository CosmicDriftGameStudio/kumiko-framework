import type { AccessRule } from "./handlers";

// Nav entry declaration. Every feature that wants to appear in the app's
// navigation tree registers one or more entries via r.nav(). The engine
// keeps the list flat — ui-core's resolveNavigation assembles the parent/
// child tree at render time, so changes (toggles, access-gating) don't
// require re-indexing a tree shape server-side.
//
// Cross-feature references are allowed: `screen` may point at any
// registered screen QN, `parent` at any registered nav QN. The boot
// validator checks both references exist + rejects parent cycles.
export type NavDefinition = {
  // Feature author writes the feature-local short id ("catalog"); the
  // registry overwrites `id` with the qualified name ("shop:nav:catalog")
  // in its stored copy. Callers of `registry.getNav(qn)` /
  // `getTopLevelNavs()` / `getNavsByParent(...)` always see the qualified
  // id — no parallel reverse index needed. `feature.navs[shortId]` on the
  // unregistered FeatureDefinition keeps the short form.
  readonly id: string;
  // i18n translation key. Resolved at render time by the renderer's
  // useTranslation hook; engine keeps it opaque.
  readonly label: string;
  // Icon key — whatever the icon registry of the active renderer understands.
  // Engine doesn't validate; unknown icons surface as a missing icon on screen,
  // not a boot failure.
  readonly icon?: string;
  // Qualified name of a parent nav entry ("<feature>:nav:<id>"). Omit for
  // top-level entries. Boot-validator rejects cycles + dangling refs.
  readonly parent?: string;
  // Sort weight within the parent's children (lower = earlier). Ties are
  // broken by registration order — features registered later appear lower.
  readonly order?: number;
  // Qualified name of the screen this entry navigates to
  // ("<feature>:screen:<id>"). Omit for pure grouping entries (a parent-only
  // nav node that renders a sub-tree but has no target screen itself).
  readonly screen?: string;
  // Role / openToAll gate. The nav resolver hides entries the user can't
  // reach; leave unset to always show (engine stays un-opinionated about
  // who sees what — apps that need default-deny can set { roles: [] }).
  readonly access?: AccessRule;
  // Workspace QNs this entry self-assigns to. Merged at boot with any
  // r.workspace({ nav: [...] }) explicit lists. Omit to leave workspace
  // membership decided solely by the workspace's nav list (or both empty
  // → entry belongs to no workspace).
  readonly workspaces?: readonly string[];
};
