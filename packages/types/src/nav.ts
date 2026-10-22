import type { AccessRule } from "./handlers.ts";
import type { NavIconKey } from "./nav-icon.ts";
import type { TargetRef } from "./target-ref.ts";
import type { TreeAction } from "./tree-node.ts";

export type { IconKey, NavIconKey } from "./nav-icon.ts";

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
  // Icon key from the closed NavIconKey vocabulary (see nav-icon.ts). Every
  // renderer's icon map is checked against the same union, so a typo'd key
  // is a compile error here rather than a missing icon at runtime.
  readonly icon?: NavIconKey;
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
  // Polymorphic click target (opens the EditorPanel via the Target-
  // Resolver) — an alternative to `screen`. A node carries either `screen` or
  // `target`; the renderer dispatches `target` instead of rendering a route
  // link. Mirrored from the former visual tree (TreeNode.target).
  readonly target?: TargetRef;
  // Hover actions on the right side of the row (VS Code pattern), visible only
  // on hover. Order follows the declaration order.
  readonly actions?: readonly TreeAction[];
  // "+" affordance on the node. Click navigates to createAction.screen or
  // dispatches createAction.target; the provider knows what "create empty"
  // means for it (new page slug, etc.).
  readonly createAction?: TreeAction;
  // Children arrive at runtime from a registered nav provider (lazy on
  // expansion, live via SSE through treeEntities), keyed by this nav QN. This
  // makes the node expandable without static children.
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
/** Client editor format for r.contentCollection() — not template body storage formats. */
export type ContentEditorFormat = "plain" | "rich" | "markdown" | "document";

export type ContentCollectionDefinition = {
  // Feature-local short id, kebab-case. Also becomes the nav entry's id, so
  // it must not collide with an r.nav()/r.screen() id in the same feature.
  // Handlers take this id, not a kind — a payload can therefore only ever
  // address a declared collection, with the rules that were declared for it.
  readonly id: string;
  // Which template-resource kind this collection lists ("mail",
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
  // rendering want HTML either way. "markdown" stores markdown text, not
  // HTML. "document" stores HTML in the document model
  // (template-resolver/document-schema), variables as data-variable nodes.
  // Defaults to "plain" (textarea).
  readonly contentFormat?: ContentEditorFormat;
  // Fixed variable names the collection's editor offers as insertable chips,
  // mapped to an example value the Preview substitutes in for `{{name}}`
  // (e.g. `{ customerName: "Max Mustermann", orderId: "A-1042" }` for an
  // ai-prompt collection). Declared once per collection, not per entry — a
  // collection-set write always persists an entry's own `variableSchema` as
  // `{}` (collections never let a user redefine the variable set), so this
  // is the only place the client can learn which variables exist and what
  // their preview values are.
  readonly variableSchema?: Readonly<Record<string, string>>;
  readonly nav: {
    readonly label: string;
    readonly icon?: NavIconKey;
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
