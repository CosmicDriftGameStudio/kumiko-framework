---
"@cosmicdrift/kumiko-bundled-features": minor
---

create-portal-session now computes returnUrl server-side and honors the catalog's purchase roles

<!-- kumiko-changes
feature: billing-foundation
type: breaking
title: create-portal-session now computes returnUrl server-side and honors the catalog's purchase roles
migration: |
  create-portal-session's payload schema is now `z.object({}).strict()` — a
  client that still sends `{ returnUrl }` gets a 400 instead of the URL
  being honored. The server now computes returnUrl itself from
  `catalog.returnPath` (joined onto `baseUrl`) or, without a catalog or
  returnPath, from `baseUrl` directly; a foundation mounted without
  `baseUrl` fails the call with UnconfiguredError on the "baseUrl" key,
  same as create-checkout-session. Update any client call to
  `portalMutation.mutate({})` — BillingPlansPanel already does this and no
  longer reads `window.location.href`, which used to trigger
  redirect_origin_not_allowed on a `www.`-prefixed origin. A server-internal
  caller like offlot-app's open-portal.write.ts, which currently does
  `ctx.write(SubscriptionFoundationHandlers.createPortalSession, { returnUrl })`,
  must drop the `returnUrl` field from that call and instead set the return
  target via `catalog.returnPath` (or, without a catalog, the target is
  simply `baseUrl`).

  Access control also changed: with a catalog configured, the handler's
  allowed roles are now `catalog.purchaseRoles` (falling back to the
  catalog's default purchase roles) instead of the hardcoded
  TenantAdmin/SystemAdmin pair. An app that lets e.g. a plain Admin role
  purchase plans must add that role to `catalog.purchaseRoles` to keep
  portal access working; conversely, a role that isn't in
  `purchaseRoles` now gets a 403 where it previously reached the handler.

  Set `catalog.returnPath` to the app's billing page (e.g.
  "/host/billing", or offlot's `${APP_BASE_PATH}/${MY_BILLING_SCREEN_ID}`),
  otherwise the portal sends the user back to the bare `baseUrl`.
-->
