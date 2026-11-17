---
"@cosmicdrift/kumiko-bundled-features": patch
---

The custom-fields `field-definition-deleted` event now carries `tenantId` (event version 2); older events without it are upcast from their stored tenant.

<!-- kumiko-changes
feature: custom-fields
type: improvement
title: Field definition deletes always name their tenant
detail: `tenantId` in the `field-definition-deleted` payload is required. Both delete handlers always set it. The projection cleanup uses it directly: `SYSTEM_TENANT_ID` removes the key from every tenant's rows, any other tenant only from that tenant's rows. Events written before the payload carried `tenantId` (version 1) get it from the tenant of the stored event through an upcaster, so the host-values projection and entity rebuilds replay them. The schema is exported from `custom-fields/events.ts` as `fieldDefinitionDeletedSchema`.
-->
