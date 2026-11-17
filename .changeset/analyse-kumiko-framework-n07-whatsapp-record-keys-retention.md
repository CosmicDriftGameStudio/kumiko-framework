---
"@cosmicdrift/kumiko-bundled-features": minor
---

`channel-whatsapp` encrypts each stream under its own record key, erases those keys after 30 days and on tenant destroy, and requires `tenant-lifecycle`.

<!-- kumiko-changes
feature: channel-whatsapp
type: breaking
title: WhatsApp PII under per-stream record keys with 30-day retention
detail: Sender number, text, button payload and status recipient of `message-received`, `throttled` and `status-updated` events are encrypted under the record key of their stream instead of the tenant key. The maintenance job `whatsapp-event-retention` (perTenant) erases the keys of streams older than 30 days, so `readWhatsappMessagePii`, `readWhatsappStatusPii` and `readWhatsappThrottledPii` return the erased sentinel for them; destroying a tenant erases all of its stream keys. A consuming job must copy what it keeps into its own entities within that window. The feature now requires `tenant-lifecycle` and owns the store table `store_whatsapp_retention_cursors`.
migration: Mount `createTenantLifecycleFeature()` (with `tenant` and `compliance-profiles`) next to `createChannelWhatsappFeature`, also in test stacks, and run `kumiko schema generate` for `store_whatsapp_retention_cursors`. Events stored before the update keep their tenant-keyed ciphertext and stay readable until the tenant is destroyed.
-->
