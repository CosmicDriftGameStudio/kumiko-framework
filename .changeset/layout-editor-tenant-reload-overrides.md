---
"@cosmicdrift/kumiko-document-designer": patch
---

Layout editor no longer asks for the platform override counts after a tenant save

<!-- kumiko-changes
feature: document-designer
type: fix
title: Layout editor no longer asks for the platform override counts after a tenant save
detail: Saving or resetting a layout as tenant admin refetched the tenant-overrides query, which only the platform admin may read, so every save logged a 403. The reload now refetches it only for the platform admin.
-->
