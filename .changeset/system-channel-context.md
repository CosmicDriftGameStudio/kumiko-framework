---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-framework": minor
---

Mails sent outside a handler as the system tenant can read their attachments: `SystemWireDeps` carries `filesForTenant`, and `buildSystemChannelContext` builds a channel context with `readAttachment` set.

<!-- kumiko-changes
feature: delivery
type: improvement
title: buildSystemChannelContext for system tenant mails outside a handler
detail: buildSystemChannelContext(deps, { config, secrets }) returns a ChannelContext for the system tenant whose readAttachment reads file and inline attachments. SystemWireDeps (wire hook and runWorkerApp wireComponents) has a new required filesForTenant that deps can pass straight in.
-->

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: filesForTenant in SystemWireDeps
detail: The wire hook and the worker wireComponents receive filesForTenant, built from the AppContext after buildServer wired it. ApiEntrypoint and WorkerEntrypoint expose that context as entrypoint.context.
-->
