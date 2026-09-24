---
"@cosmicdrift/kumiko-framework": minor
---

Tenant-resource and tenantTierResolver extension options are typed; invalid registrations fail tenant destroy loudly

<!-- kumiko-changes
feature: framework
type: breaking
title: Tenant-resource and tenantTierResolver extension options are typed; invalid registrations fail tenant destroy loudly
migration: |
  Registrations of storageProvider, searchAdapter, externalResource and infraResource now require options of type TenantResourceExtensionHooks (destroyTenant(tenantId, ctx) => Promise<void>); tenantTierResolver requires a TierResolverPlugin with build. StorageProvider* types remain as aliases of the new TenantResource* types. A tenantData or tenant-resource registration whose destroy hook is missing now fails the destruction stage with the extension and entity name instead of being skipped.
-->
