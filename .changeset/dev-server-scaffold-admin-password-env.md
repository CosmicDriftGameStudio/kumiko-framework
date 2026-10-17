---
"@cosmicdrift/kumiko-dev-server": patch
"create-kumiko-app": patch
---

New projects read the prod admin password from DEMO_ADMIN_PASSWORD

<!-- kumiko-changes
feature: dev-server
type: fix
title: New projects read the prod admin password from DEMO_ADMIN_PASSWORD
detail: The scaffolded bin/main.ts no longer seeds the prod admin with a fixed password. It reads DEMO_ADMIN_PASSWORD (declared in the env schema, min 12 chars), and boot fails without it. Existing apps are untouched; apps from an older scaffold should change bin/main.ts the same way.
-->
