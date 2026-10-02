---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
---

`tenant-caps:list` now rejects a malformed pagination cursor and unsupported or repeated filters with a validation error instead of returning a wrong page or silently ignoring the filter, and loads per-tenant usage in parallel. The `cap-counter` operator list is no longer searchable, because search resolved against the caller's own tenant instead of all tenants.

<!-- kumiko-changes
feature: cap-overview
type: fix
title: tenant-caps:list validates cursor and filters, parallel usage reads; cap-counter list not searchable
-->
