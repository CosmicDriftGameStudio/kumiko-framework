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

// A feature's content collection — a set of template-resources of one `kind`,
// mounted in the nav next to the feature it belongs to rather than under a
// central "Content" section. Declared via r.contentCollection(), which
// registers the nav entry (always `provider: true`, the tree children arrive
// at runtime) and records the `kind` so the client can build the matching tree
// provider without the app repeating it.
//
// `parent` may point at another feature's nav QN; the boot validator rejects
// dangling refs, so a collection mounted under a feature that isn't mounted
// fails boot instead of silently disappearing from the sidebar.
export type ContentCollectionDefinition = {
  // Feature-local short id, kebab-case. Also becomes the nav entry's id, so
  // it must not collide with an r.nav()/r.screen() id in the same feature.
  // Handlers take this id, not a kind — a payload can therefore only ever
  // address a declared collection, with the rules that were declared for it.
  readonly id: string;
  // Which template-resource kind this collection lists ("mail-html",
  // "document-pdf", "text-block", ...). The engine keeps it opaque —
  // bundled-features owns the kind vocabulary. Two collections may share a
  // kind and still differ in access and ownership.
  readonly kind: string;
  // Who may read and write this collection's entries. Declared at mount time
  // by the app, because a bundled feature cannot know the host's role
  // vocabulary — same reasoning as the `access` option on tags/folders/ledger.
  // Omitted means the mounting app didn't decide; the feature's own default
  // applies.
  readonly access?: AccessRule;
  // "tenant": one set of entries shared by everyone in the tenant (reply
  // snippets an admin curates). "user": every user keeps their own (mail
  // signatures). Defaults to "tenant".
  readonly ownership?: "tenant" | "user";
  // Which editor the client renders for this collection's entries — not how
  // the content is stored. "rich" still stores HTML, because mail and PDF
  // rendering want HTML either way. Defaults to "plain" (textarea).
  readonly contentFormat?: "plain" | "rich";
  readonly nav: {
    readonly label: string;
    readonly icon?: string;
    readonly parent?: string;
    readonly order?: number;
    // Visibility of the nav node. Leave unset — it then follows the
    // collection's `access`, so the sidebar never offers a node whose
    // contents the handler will refuse. Set it only to hide the node from
    // someone who may still reach the data another way.
    readonly access?: AccessRule;
    readonly workspaces?: readonly string[];
    // "+" affordance on the node and hover actions on the row — same meaning
    // as on NavDefinition. Without a createAction a collection can only list
    // what already exists; the target is usually the owning feature's
    // r.treeActions create.
    readonly createAction?: TreeAction;
    readonly actions?: readonly TreeAction[];
  };
};
