---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-dev-server": patch
---

App unsubscribe pages can wear the tenant's mail look

<!-- kumiko-changes
feature: delivery
type: improvement
title: createUnsubscribePageChromeReader gives app routes the tenant branding for unsubscribe pages
detail: The JSDoc of renderUnsubscribeResultPage pointed to a chrome read that only works for SystemAdmin, so app routes for legacy unsubscribe links rendered without branding. The new `createUnsubscribePageChromeReader({ dispatchSystemQuery })` returns `(tenantId, locale) => MailChrome | null`, failing soft to null. Build it once in the `wire` hook, whose deps now also carry `dispatchSystemQuery` (runProdApp, runWorkerApp.wireComponents, createKumikoServer), and call it with a tenant the route resolved itself, for example from the Host, never with a tenantId from the query string or body. The chrome query itself stays SystemAdmin-only; anonymous `/api/query` callers are still rejected for every tenant.
-->
