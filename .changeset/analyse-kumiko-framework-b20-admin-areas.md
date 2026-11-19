---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-document-designer": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

Workspaces collect the admin navs of every mounted feature with `collectAdminArea`.

<!-- kumiko-changes
feature: framework
type: improvement
title: Workspaces collect navs by admin area
detail: A nav declares `adminArea: "tenant" | "platform"`, a workspace declares `collectAdminArea` with the same value. At boot the workspace lists every matching nav of the mounted features after its explicit `nav` list, sorted by `order`, each QN once. The navs count as reachable for the unreachable-screen warning. `AdminNavArea` is exported from the engine.
-->

admin-shell collects its workspace navs instead of listing them.

<!-- kumiko-changes
feature: admin-shell
type: breaking
title: admin-shell workspaces collect navs; includeDocumentDesigner removed
detail: The tenant and platform workspaces of admin-shell now use `collectAdminArea`, so they also list event consumers, export jobs, feature toggles, the cap list and the document templates of mounted features. A new platform nav `admin-shell:nav:users` opens `user:screen:user-list` for SystemAdmin. Apps that keep `registerWorkspaces: false` set `collectAdminArea` on their own workspaces and drop the hand-written nav lists. The option `includeDocumentDesigner` is removed because the document-designer navs carry their area.
migration: Remove `includeDocumentDesigner` from `createAdminShellFeature`. In app workspaces replace the lists of standard nav QNs with `collectAdminArea: "tenant"` or `"platform"`, and delete own users and system-check navs in favour of `admin-shell:nav:users` and `createReadinessFeature({ nav: { adminArea: "platform" } })`.
affects: createAdminShellFeature, includeDocumentDesigner, registerWorkspaces, admin-shell:nav
-->

delivery and sessions let the app pick the admin area of their log navs.

<!-- kumiko-changes
feature: delivery
type: improvement
title: delivery-log nav takes an adminArea option
detail: `createDeliveryFeature({ adminArea })` tags the delivery-log nav for a collecting workspace. Unset, the nav stays out of every admin area, as before.
-->

<!-- kumiko-changes
feature: sessions
type: improvement
title: session-list nav takes an adminArea option
detail: `createSessionsFeature({ adminArea })` tags the session-list nav for a collecting workspace. Unset, the nav stays out of every admin area, as before.
-->

<!-- kumiko-changes
feature: readiness
type: improvement
title: System-check nav takes an adminArea
detail: `createReadinessFeature({ nav: { adminArea } })` puts the system-check nav into the collecting admin workspace.
-->

<!-- kumiko-changes
feature: document-designer
type: improvement
title: Template navs carry their admin area
detail: `document-designer:nav:templates` belongs to the tenant area, `document-designer:nav:platform-templates` to the platform area, so collecting workspaces list them without extra wiring.
-->
