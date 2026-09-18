---
"@cosmicdrift/kumiko-bundled-features": patch
---

User-data-export ZIPs now write to `exports/{tenantId}/{jobId}.zip` instead of `{tenantId}/exports/{jobId}.zip`, so a single S3 lifecycle rule with `Prefix: "exports/"` can expire export bundles across every tenant without ever matching a normal user upload in the same bucket.

<!-- kumiko-changes
feature: user-data-rights
type: fix
title: export ZIPs write to exports/{tenantId}/{jobId}.zip, enabling one bucket-wide S3 lifecycle rule
detail: buildExportStorageKey previously put the tenant first ({tenantId}/exports/{jobId}.zip), so no S3 prefix rule could target "all tenants, then /exports/" without also matching normal user uploads in the same bucket. The key now starts with the fixed exports/ segment, tenant stays as the second segment. downloadStorageKey is stored per job and never recomputed, so existing rows keep resolving through their old key — no migration needed.
-->
