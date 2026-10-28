---
"@cosmicdrift/kumiko-testing": patch
---

`loginViaUi` returns only after the app has left `/login`.

<!-- kumiko-changes
feature: testing
type: fix
title: loginViaUi waits for the landing page after the login
detail: loginViaUi returned as soon as the login form disappeared, while the app was still navigating to its landing page. A page.goto right after it was then interrupted by that navigation ("Navigation to … is interrupted by another navigation to …/d"). It now waits until the URL has left /login, with and without the MFA step.
-->
