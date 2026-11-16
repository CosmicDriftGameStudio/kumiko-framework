---
"@cosmicdrift/kumiko-bundled-features": patch
---

The custom-fields `field-definition-deleted` event now requires `tenantId`, and the cleanup no longer guesses the owning tenant from the stream.

<!-- kumiko-changes
feature: custom-fields
type: improvement
title: Field definition deletes always name their tenant
detail: `tenantId` in the `field-definition-deleted` payload is required. Both delete handlers always set it. The projection cleanup uses it directly: `SYSTEM_TENANT_ID` removes the key from every tenant's rows, any other tenant only from that tenant's rows. The fallback to the event's stream tenant for older payloads is gone. The schema is exported from `custom-fields/events.ts` as `fieldDefinitionDeletedSchema`.
-->
