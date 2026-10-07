---
"@cosmicdrift/kumiko-testing": patch
---

E2E webServer infra defaults no longer override keys defined in the app's `.env`; precedence is shell environment, then `.env`, then the template default

<!-- kumiko-changes
feature: testing
type: fix
title: E2E webServer infra defaults no longer override keys defined in the app's .env
-->
