---
"@cosmicdrift/kumiko-testing": patch
---

New `clearSession(page)` in `@cosmicdrift/kumiko-testing/e2e`: navigates to `about:blank` before clearing cookies. Clearing cookies while an app page is still open lets that page redirect itself to `/login?next=…` on its next request, racing the test's next navigation (flaky session switches at 4 workers). `loginViaUi` and the `seedTenant` fixture's `loginAs` now use it. Apps replace `page.context().clearCookies()` with `clearSession(page)`.

<!-- kumiko-changes
feature: testing
type: improvement
title: clearSession(page) for race-free session switches in E2E
-->
