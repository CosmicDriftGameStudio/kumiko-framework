import type { AccessRule } from "./handlers";
import type { TargetRef } from "./target-ref";
import type { TreeAction } from "./tree-node";

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
  // Polymorphes Klick-Ziel (öffnet die EditorPanel-Maske via Target-
  // Resolver) — Alternative zu `screen`. Ein Knoten trägt screen XOR
  // target; der Renderer dispatcht das target statt einen Route-Link zu
  // rendern. Gespiegelt aus dem alten Visual-Tree (TreeNode.target).
  readonly target?: TargetRef;
  // Hover-Actions rechts in der Zeile (VS-Code-Pattern) — erst bei Hover
  // sichtbar. Reihenfolge wie deklariert.
  readonly actions?: readonly TreeAction[];
  // „+"-Affordance am Knoten. Klick dispatcht createAction.target; der
  // Provider weiß was „leer befüllen" für ihn heißt (neuer Page-Slug etc.).
  readonly createAction?: TreeAction;
  // Children kommen zur Laufzeit aus einem registrierten nav-provider
  // (lazy beim Ausklappen, SSE-live via treeEntities), keyed auf diese
  // Nav-QN. Macht den Knoten expandable auch ohne statische children.
  readonly provider?: boolean;
  // Role / openToAll gate. The nav resolver hides entries the user can't
  // reach; leave unset to always show (engine stays un-opinionated about
  // who sees what — apps that need default-deny can set { roles: [] }).
  // If `screen` is set and `access` is left unset, the client-side nav
  // builder (buildNavRegistrySliceForApp) fills this in from the target
  // screen's own `access` — a nav entry never invites a role into a 403.
  // An explicit `access` here always wins over the screen's.
  readonly access?: AccessRule;
  // Workspace QNs this entry self-assigns to. Merged at boot with any
  // r.workspace({ nav: [...] }) explicit lists. Omit to leave workspace
  // membership decided solely by the workspace's nav list (or both empty
  // → entry belongs to no workspace).
  readonly workspaces?: readonly string[];
};
