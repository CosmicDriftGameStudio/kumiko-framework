---
"@cosmicdrift/kumiko-document-designer": patch
---

Saving a layout as tenant admin no longer requests the system-only tenant overrides

<!-- kumiko-changes
feature: document-designer
type: fix
title: Tenant layout save no longer triggers a 403 on tenant overrides
detail: After a save the layout editor refetched every query, including the tenant overrides that only a system admin may read. Tenant admins got an access_denied response on each save. The overrides are now refetched for system admins only.
-->
