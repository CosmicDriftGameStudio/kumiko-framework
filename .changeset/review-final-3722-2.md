---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-document-designer": patch
---

The layout editor edits the scope of the row it was opened from. Before, a SystemAdmin who clicked Edit on a tenant layout row on the tenant screen silently edited and published the system layout for all tenants. The row action now passes the row's `origin`, the editor asks `layout-source` for `scope` tenant or system, and `layout-source` refuses `scope: "system"` for anyone but a SystemAdmin.

<!-- kumiko-changes
feature: document-designer
type: fix
title: layout editor edits the scope of the opened row
detail: The edit action of layout rows passes the row origin to the layout editor. A SystemAdmin opening a tenant row now loads and saves the tenant layout through layout-source with scope tenant and upsert-tenant, instead of changing the system layout. layout-source takes an optional scope and answers 403 to scope system for non-SystemAdmins.
-->
