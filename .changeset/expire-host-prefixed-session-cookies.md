---
"@cosmicdrift/kumiko-framework": patch
---

Login and logout expire leftover __Host- session cookies when the names resolve unprefixed

<!-- kumiko-changes
feature: framework
type: fix
title: A later cookieDomain or secureCookies:false no longer leaves stale __Host- auth and csrf cookies behind
detail: expireLegacySessionCookieVariants covers both directions. With unprefixed names and secure cookies, setAuthCookies and clearSessionCookies now also expire __Host-kumiko_auth and __Host-kumiko_csrf as Secure, Path=/, host-only. Before, the browser kept sending the stale __Host-kumiko_csrf in X-CSRF-Token and every write failed with csrf_token_mismatch until it expired.
-->
