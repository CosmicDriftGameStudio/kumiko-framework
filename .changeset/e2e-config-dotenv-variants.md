---
"@cosmicdrift/kumiko-testing": patch
---

defineAppE2eConfig respects .env.local and .env.<NODE_ENV> as well as .env

<!-- kumiko-changes
feature: testing
type: fix
title: E2E webServer env no longer overrides keys from .env.local or .env.<NODE_ENV>
detail: Keys defined in the app's .env.local or .env.<NODE_ENV> (not only .env) are now left to the server's own dotenv loading instead of being overridden by the template service defaults.
-->
