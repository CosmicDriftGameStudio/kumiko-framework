---
"@cosmicdrift/kumiko-testing": patch
---

`seedTenant().loginAs` now switches users via `clearSession(page)` instead of a bare `clearCookies()`, so the page still open on the previous session can no longer redirect to `/login?next=…` and race the new login.

<!-- kumiko-changes
feature: testing
type: fix
title: seedTenant loginAs switches users via clearSession
-->
