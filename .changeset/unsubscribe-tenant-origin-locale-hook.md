---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
---

Unsubscribe links use the tenant's host and the mail's language, apps learn about address opt-outs

<!-- kumiko-changes
feature: delivery
type: improvement
title: Unsubscribe links use the tenant's host and the mail's language, apps learn about address opt-outs
detail: unsubscribeLinks and the runProdApp option unsubscribe take tenantOrigin, an app callback that returns the sending tenant's own origin (subdomain or custom domain) per send; null, a throw or a non-https value fall back to the app origin and never fail the send. The signed token now carries the mail's locale (notify option locale), so the confirmation, result and undo pages render in that language; tokens without it keep working and show English. A form post to the resubscribe route now answers with an HTML page, JSON callers are unchanged. After a committed address opt-out an app job declared with trigger on DeliveryHandlers.unsubscribeAddress receives addressHash, notificationType and channel (unsubscribeAddressPayloadSchema) with the tenant in ctx.triggeredBy.tenantId; hashUnsubscribeAddress(email) matches it to the app's own subscriber. UNSUBSCRIBE_PAGE_EN exports the English page texts, German and Spanish come with the locale packages.
-->
