---
"@cosmicdrift/kumiko-guards": patch
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-document-designer": minor
---

The pre-push shim no longer executes a `kumiko-pre-push` from an untrusted ancestor. The upward walk ends at `$HOME` (inclusive) and skips ancestors owned by another user or writable by group or others, such as `/tmp`.

`@cosmicdrift/kumiko-framework/search` exports `collectSearchableFieldNames` and `configureTenantSearchIndex`, so apps stop copying the per-tenant index setup. `@cosmicdrift/kumiko-server-runtime` exports `diskFileRoute`, an anonymous GET route that serves allowlisted disk files with ETag and 304. `@cosmicdrift/kumiko-renderer/flow-diagram` exports `renderFlow` and the `FlowSpec` types for static animated SVG flow diagrams.

Stock caps reserve atomically under a per-tenant advisory lock, so two parallel writes can no longer both pass the cap. The document designer ships its own stylesheet, disables Upload when the files feature is not mounted, and disables the test mail with a hint when the server cannot resolve an address (new `send-test-status` query).

<!-- kumiko-changes
feature: guards
type: fix
title: Pre-push shim skips untrusted ancestors and stops at $HOME
detail: The shim walked up to / and could exec a kumiko-pre-push planted in /tmp or another shared directory. The walk now ends at $HOME and skips ancestors that another user owns or that group or others can write to.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: Search index setup helpers
detail: collectSearchableFieldNames(registry) returns the deduplicated searchable fields of all entities and configureTenantSearchIndex(adapter, registry, tenantId) configures a tenant index with them, both exported from the search entry.
-->

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: diskFileRoute for allowlisted disk files
detail: diskFileRoute({ path, resolveFile }) returns an anonymous GET extra route with a :file parameter. resolveFile maps the raw name to a disk path or null for 404; the file is served with mime type, ETag and 304 handling.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: flow-diagram subpath
detail: "@cosmicdrift/kumiko-renderer/flow-diagram" exports renderFlow(spec) and the FlowSpec, FlowNode, FlowEdge, FlowIcon types, a pure string function that renders an animated SVG flow diagram.
-->

<!-- kumiko-changes
feature: bundled-features
type: fix
title: Stock caps are atomic under parallel writes
detail: withStockCap now takes a transaction-scoped advisory lock per tenant and cap, so concurrent creates cannot both pass the check and exceed the cap.
-->

<!-- kumiko-changes
feature: bundled-features
type: improvement
title: send-test-status query for the template test mail
detail: template-resolver:query:send-test-status answers whether a test mail can be sent (canSend) and, if not, why (no_channel or no_address), so clients can disable the action instead of failing on send.
-->

<!-- kumiko-changes
feature: document-designer
type: improvement
title: Stylesheet export for the designer
detail: "@cosmicdrift/kumiko-document-designer/web/styles.css" registers the designer's own Tailwind sources. Apps that embed the designer import it after the renderer stylesheet.
-->

<!-- kumiko-changes
feature: document-designer
type: fix
title: Upload and test mail follow the server's capabilities
detail: Upload is disabled with a hint when the files feature is not mounted, and the test mail button is disabled with a hint when the server has no email channel or no address for the user.
-->

<!-- kumiko-changes
feature: renderer
type: breaking
title: Renderer stylesheet no longer scans the document designer
detail: The renderer stylesheet stopped scanning the document designer sources by relative path, which broke in isolated installs.
migration: Apps that embed the document designer add `@import "@cosmicdrift/kumiko-document-designer/web/styles.css";` after the renderer stylesheet import in their styles.css.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: TenantDb.advisoryXactLock
detail: ctx.db.advisoryXactLock(namespace, key) takes a transaction-scoped pg_advisory_xact_lock keyed on the handle's own tenantId plus key, so tenants never contend and the caller cannot pick another tenant. It needs no unsafeRaw grant.
-->

<!-- kumiko-changes
feature: bundled-features
type: improvement
title: withStockCap no longer widens the handler's grants
detail: withStockCap serialises through TenantDb.advisoryXactLock instead of ctx.db.unsafeRaw(), so wrapped handlers no longer receive an implicit unsafeRaw grant.
-->

<!-- kumiko-changes
feature: framework
type: breaking
title: Boot check for projectionList writeHandler actions
detail: Boot now rejects projectionList rowActions and toolbarActions of kind writeHandler whose handler is not a registered write-handler QN. Such actions only failed on click before.
migration: Fix the handler QN to "<feature>:write:<short>" of a handler declared via r.writeHandler(...), or remove the action. Apps that fail to boot name the screen and action id in the error.
-->

<!-- kumiko-changes
feature: guards
type: fix
title: Pre-push shim also vets node_modules/.bin
detail: The shim now requires node_modules/.bin itself to be owned by the user and not group or world writable before executing kumiko-pre-push from it, in the guards hook and the dev-server husky template.
-->
