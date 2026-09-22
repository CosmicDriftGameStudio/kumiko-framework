---
"@cosmicdrift/kumiko-bundled-features": minor
---

Billing webhook wiring moves from a raw handler to createSubscriptionWebhookRoute()/createWebhookRoute()

<!-- kumiko-changes
feature: billing-foundation
type: breaking
title: Billing webhook wiring moves from a raw handler to createSubscriptionWebhookRoute()/createWebhookRoute()
migration: |
  createSubscriptionWebhookHandler(...) is replaced by createSubscriptionWebhookRoute({ path?, afterDispatch? }), which returns an ExtraRouteDefinition for the extraRoutes array instead of a manually-mounted handler; the route path still defaults to /webhooks/subscription/:providerName. createSubscriptionTierSync(...) deps drop db, registry, dispatchSystemWrite and tierAssignmentTable - it now exposes .createWebhookRoute(), which produces the signature-verified ExtraRouteDefinition to add to extraRoutes. A webhook previously wired as extraRoutes: (app, deps) => { app.post("/webhooks/subscription/:providerName", createSubscriptionWebhookHandler(...)) } becomes extraRoutes: [createSubscriptionTierSync({ ... }).createWebhookRoute()] (or createSubscriptionWebhookRoute({...}) for the lower-level handler), with db/registry/dispatchSystemWrite no longer passed in - the route's signature-entry deps (systemQuery, dispatchSystemWrite, dispatchSystemQuery) cover the read/write access the old handler needed.
-->
