---
"@cosmicdrift/kumiko-framework": minor
---

`AuthRoutesConfig.retiredCookieDomains` lists domains that used to carry the auth cookies. Login and logout also send delete headers for `kumiko_auth` and `kumiko_csrf` with `Domain=<entry>`, so a stale cookie from an earlier `cookieDomain` no longer shadows the new session after the value changes. Login sends these deletes before the new `Set-Cookie` headers. `createAuthRoutes` throws on an empty entry, on `;`, comma, whitespace, CR or LF, and on an entry equal to the current `cookieDomain`. Without the option nothing changes. Remove an entry once the session TTL has passed since the switch.

<!-- kumiko-changes
feature: framework-core
type: improvement
title: retiredCookieDomains clears auth cookies left on a former cookieDomain
-->
