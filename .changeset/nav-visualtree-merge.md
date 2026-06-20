---
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Fold the VisualTree navigation into the single shadcn NavTree — one nav, not
two. Dynamic, runtime-extendable nav nodes now live in the same sidebar as the
static `r.nav` entries: a node declared with `r.nav({ provider: true })` pulls
its children lazily from a client-registered nav-provider and refreshes them
live on entity events (SSE) — the capability the old `navigation: "tree"`
VisualTree workspace used to provide, now available everywhere.

**Breaking — `ClientFeatureDefinition` (renderer-web):** the `treeProvider`,
`treeEntities` and `treeActions` fields are removed. Provide dynamic nav
children via `navProviders` / `navEntities` (keyed on the nav QN) and editor
components via `resolvers`, attached to an `r.nav({ provider: true })` node.

**Breaking — VisualTree removed:** the `VisualTree` / `TreeNodeRenderer`
components and the tree-providers context are deleted. `WorkspaceShell` always
renders `NavTree`; a target persisted in the URL (`?t=feat:action&a_*=…`)
renders the `EditorPanel` in the content area instead of the routed screen.
`WorkspaceDefinition.navigation` is now a **no-op** (kept for now, deferred
removal) — `navigation: "tree"` no longer switches the sidebar component.

**`textContentClient` / `legalPagesClient` (bundled-features):** both now take
an optional `{ navId }`. The consuming app owns the nav node (label, icon,
access — same convention as `managed-pages`) by registering
`r.nav({ id, provider: true })` in its own feature and passing that node's QN
as `navId`; the bundled-feature supplies the children + editor. **Without
`navId` no sidebar node is created** — apps that mount these features
server-side only (legal routes) no longer get a stray, provider-less nav node.

Migration for an app that used a `navigation: "tree"` workspace (e.g. an admin
content/legal editor): register `r.nav({ provider: true })` nodes in your own
feature with the access you want, add their QNs to the workspace's nav members,
drop `navigation: "tree"`, and pass each node's QN as `navId` to
`textContentClient({ navId })` / `legalPagesClient({ navId })`.
