---
"@cosmicdrift/kumiko-framework": patch
---

The Origin guard now also covers the public routes that sign a user in.

<!-- kumiko-changes
feature: framework
type: fix
title: Origin guard blocks login CSRF on public session routes
detail: The Origin allowlist guard (active with `auth.allowedOrigins`, or with host-only cookies and a known `auth.publicOrigin`) only ran on authenticated cookie requests. A foreign page could therefore post a plain form to `/auth/login` and sign the visitor into the attacker's account. `/auth/login`, `/auth/mfa/verify`, `/auth/mfa/preauth-confirm`, `/auth/signup-confirm`, `/auth/invite-accept-with-login` and `/auth/invite-signup-complete` now answer 403 `origin_not_allowed` to a POST with a foreign `Origin`, or without Origin but with `Sec-Fetch-Site: cross-site`. Requests without an Origin (native apps, server clients) pass as before, and deployments without the guard are unchanged.
-->
