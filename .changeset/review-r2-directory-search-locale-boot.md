---
"@cosmicdrift/kumiko-bundled-features": patch
---

Several review fixes in bundled features. The tenant reference combobox now searches tenants by name through `tenant:query:tenant-directory`, so tenants beyond the first page can be picked. Removing the last tenant admin reports "cannot remove" instead of "cannot demote". `user:write:create` and `user:write:update` store the locale tag in canonical form (`DE-AT` becomes `de-AT`). Tenant-lifecycle rejects `tenantData`, `storageProvider`, `searchAdapter`, `externalResource` and `infraResource` registrations without a destroy function at boot instead of during tenant destruction. The convention `tier-assignment:create`/`update` and `tenant:entity:list`/`update` handlers are hidden from the agent in favour of their canonical counterparts.

<!-- kumiko-changes
feature: tenant
type: fix
title: Tenant directory search, canonical user locale, last-admin remove message and destroy-hook boot check
-->
