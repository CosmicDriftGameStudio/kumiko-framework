---
"@cosmicdrift/kumiko-dev-server": patch
---

New apps from `create-kumiko-app` no longer write `emailVerified: true` for the dev admin in `bin/server.ts`.

<!-- kumiko-changes
feature: dev-server
type: improvement
title: Scaffolded dev admin leaves emailVerified to the boot seed
detail: The boot seed marks the operator-created admin and the seed shortcut accounts as email-verified, so the scaffolded `bin/server.ts` no longer sets `emailVerified: true` on its own. Self-registered users still go through the verify flow.
migration: Optional. Existing apps can drop `emailVerified: true` from `auth.admin` in `bin/server.ts` and `bin/main.ts`; an explicit value still wins over the default.
-->
