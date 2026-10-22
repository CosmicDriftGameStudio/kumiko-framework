---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-document-designer": patch
---

The layout editor edits the scope of the screen it was opened from. Before, a SystemAdmin who clicked Edit on a system-origin layout row on the tenant screen silently edited and published the system layout for all tenants. The tenant overview now always opens the tenant editor, the platform overview opens the new `platform-layout-editor` screen (SystemAdmin only) for the system layout, the editor asks `layout-source` for `scope` tenant or system, and `layout-source` refuses `scope: "system"` for anyone but a SystemAdmin.

<!-- kumiko-changes
feature: document-designer
type: fix
title: layout editor scope follows the entry screen
detail: The tenant overview opens layout rows in the tenant editor even for a SystemAdmin, so a system-origin row there loads and saves the tenant layout through layout-source with scope tenant and upsert-tenant. The platform overview opens the new platform-layout-editor screen (PLATFORM_LAYOUT_EDITOR_SCREEN_ID) for the system layout. layout-source takes an optional scope and answers 403 to scope system for non-SystemAdmins. templateRowActions now takes { platform }.
-->
