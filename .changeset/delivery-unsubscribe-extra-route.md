---
"@cosmicdrift/kumiko-bundled-features": minor
---

Delivery unsubscribe route is now mountable via extraRoutes

<!-- kumiko-changes
feature: delivery
type: improvement
title: Delivery unsubscribe route is now mountable via extraRoutes
detail: |
  `createUnsubscribeRoute` previously returned a raw Hono app that needed a
  `DbConnection` (`{ db, jwtSecret }`) and had to be mounted by hand with
  `stack.app.route(...)`, bypassing the framework's request pipeline. It now
  returns an `ExtraRouteDefinition` built via `signatureRoute`, taking only
  `{ secret }`, and mounts at the fixed path `GET /api/delivery/unsubscribe?token=`
  (exported as `DELIVERY_UNSUBSCRIBE_PATH`). Mount it with
  `extraRoutes: [createUnsubscribeRoute({ secret: env.UNSUBSCRIBE_SECRET })]`.
  `signUnsubscribeToken` / `signAddressUnsubscribeToken` must sign with the
  same secret. The secret must be at least 32 characters and must NOT reuse
  the app's session `JWT_SECRET` — all three entry points fail fast on a
  short secret.
  The write itself now goes through two new SystemAdmin-only handlers,
  `delivery:write:unsubscribe-address` and `delivery:write:unsubscribe-user`,
  dispatched via `dispatchSystemWrite` once the route's `verify()` has proven
  the token's authenticity. An invalid or expired token always responds 400
  with `{ error: { code: "unsubscribe_token_invalid" } }`, never leaking the
  underlying JWT-library error text.
  New notification-preference and notification-address-opt-out rows get a
  deterministic aggregate id derived from (tenant, user or address hash,
  notificationType, channel), so concurrent clicks on the same link collide
  at the event-store append and converge on one row instead of failing with
  a unique or version conflict. Existing rows keep their ids.
-->
