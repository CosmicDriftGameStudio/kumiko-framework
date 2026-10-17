---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-server-runtime": minor
---

Delivery signs unsubscribe links itself

<!-- kumiko-changes
feature: delivery
type: improvement
title: Delivery signs unsubscribe links itself
detail: r.notification(name, { unsubscribe: true }) makes delivery put a signed data.unsubscribeUrl into every email of that notification when the service has unsubscribeLinks. User recipients get a user token, route recipients an address token (only with a blind-index key, otherwise no link). The token is scoped to tenant, notification and channel; a link the caller passes in data.unsubscribeUrl wins. runProdApp option unsubscribe: { secret } mounts createUnsubscribeRoutes and wires the links; the base URL comes from auth.publicOrigin, auth.mail.baseUrl or APP_BASE_URL, and without one boot warns and no link is added.
-->
