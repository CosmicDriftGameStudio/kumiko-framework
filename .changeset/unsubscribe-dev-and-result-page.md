---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-dev-server": minor
---

runDevApp takes the unsubscribe option, and the unsubscribe result page is exported

<!-- kumiko-changes
feature: delivery
type: improvement
title: Unsubscribe links in dev and a reusable result page
detail: runDevApp accepts unsubscribe: { secret, tenantOrigin? } like runProdApp, mounts the unsubscribe routes and signs the links (base URL from auth.mail.baseUrl or APP_BASE_URL). Both share resolveUnsubscribeWiring from server-runtime. delivery exports renderUnsubscribeResultPage({ kind: "unsubscribed" | "resubscribed" | "failed", locale, resubscribeToken? }), the page the unsubscribe routes answer with, for apps that serve their own (e.g. legacy) unsubscribe links; without a resubscribeToken it offers no undo button.
-->
