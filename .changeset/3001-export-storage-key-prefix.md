---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

User-data-export ZIPs now write to `exports/{tenantId}/{jobId}.zip` instead of `{tenantId}/exports/{jobId}.zip`, so a single S3 lifecycle rule with `Prefix: "exports/"` can expire export bundles across every tenant without ever matching a normal user upload in the same bucket. `@cosmicdrift/kumiko-framework/files` exports the shared `tenantExportPrefix`/`tenantStoragePrefixes` helpers behind both the key-builder and the tenant-destroy storage sweep, so `files-tenant-data`'s `fileRefStorageDestroyHook` now wipes a tenant's export bundles too, not just its `{tenantId}/`-prefixed uploads.

<!-- kumiko-changes
feature: user-data-rights
type: fix
title: export ZIPs write to exports/{tenantId}/{jobId}.zip, enabling one bucket-wide S3 lifecycle rule
detail: buildExportStorageKey previously put the tenant first ({tenantId}/exports/{jobId}.zip), so no S3 prefix rule could target "all tenants, then /exports/" without also matching normal user uploads in the same bucket. The key now starts with the fixed exports/ segment via the new @cosmicdrift/kumiko-framework/files tenantExportPrefix() helper, tenant stays as the second segment. downloadStorageKey is stored per job and never recomputed, so existing rows keep resolving through their old key — no migration needed. tenantStoragePrefixes() (also new in framework/files) lists every prefix a tenant's binaries can live under; files-tenant-data's fileRefStorageDestroyHook now sweeps all of them on tenant-destroy instead of only {tenantId}/, closing a gap where a destroyed tenant's decrypted GDPR export bundles would have survived under the new exports/ prefix.
-->
