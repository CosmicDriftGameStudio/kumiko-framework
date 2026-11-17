---
"@cosmicdrift/kumiko-bundled-features": minor
---

`channel-whatsapp` encrypts each stream under its own record key, erases those keys on tenant destroy and, when the app sets `eventRetentionDays`, after that many days. It requires `tenant-lifecycle`.

<!-- kumiko-changes
feature: channel-whatsapp
type: breaking
title: WhatsApp PII under per-stream record keys, opt-in retention
detail: Sender number, text, button payload and status recipient of `message-received`, `throttled` and `status-updated` events are encrypted under the record key of their stream instead of the tenant key; destroying a tenant erases all of its stream keys. The new option `eventRetentionDays` of `createChannelWhatsappFeature` is opt-in and has no default: only when it is set, the maintenance job `whatsapp-event-retention` (perTenant) erases the keys of streams older than that many days, so `readWhatsappMessagePii`, `readWhatsappStatusPii` and `readWhatsappThrottledPii` return the erased sentinel for them. Without it no job is registered and no key is erased before tenant destroy. A consuming job must copy what it keeps into its own entities within the window. The feature now requires `tenant-lifecycle` and owns the store table `store_whatsapp_retention_cursors`.
migration: Mount `createTenantLifecycleFeature()` (with `tenant` and `compliance-profiles`) next to `createChannelWhatsappFeature`, also in test stacks, and run `kumiko schema generate` for `store_whatsapp_retention_cursors`. Set `eventRetentionDays` (for example 30) to switch the retention job on. Events stored before the update keep their tenant-keyed ciphertext and stay readable until the tenant is destroyed.
affects: channel-whatsapp, ChannelWhatsapp, eventRetentionDays, readWhatsappMessagePii, readWhatsappStatusPii, readWhatsappThrottledPii
-->
