---
"@cosmicdrift/kumiko-bundled-features": patch
---

An in-app plan switch and a provider webhook for the same tenant no longer run past each other.

<!-- kumiko-changes
feature: billing-foundation
type: fix
title: Plan switch and webhooks share the subscription stream lock
detail: `switch-plan` took its own per-tenant advisory lock while `process-event` locks the subscription stream under another namespace, so a webhook arriving during the provider call read the stream without the pending switch and stored `subscription.updated` without the consent. The pending-switch check now takes the same lock as `process-event`, so such a webhook waits until the switch is committed. The list of state events is defined once in `events.ts`.
-->
