---
"@cosmicdrift/kumiko-dev-server": minor
"@cosmicdrift/kumiko-server-runtime": minor
"create-kumiko-app": minor
---

dev-server: scaffold shows the signed-in user and German copy, stack seeds get the seeded admin, CI template and infraRef move to reusables-v2.0.0.

<!-- kumiko-changes
feature: dev-server
type: improvement
title: Scaffolded apps show the user, speak German and seed demo data as the real admin
detail: The scaffolded shell gets the signed-in user, the app mounts the German locale, and its kumiko.config.ts turns on requireFieldValueTranslations. A `SeedFn` receives `(stack, { admin })`: the seeded admin as a session user (first membership), undefined without auth. The scaffolded demo seed uses it instead of TestUsers.admin. `applyStandardBootSeeds` returns `{ adminUserId? }`.
-->

<!-- kumiko-changes
feature: dev-server
type: improvement
title: New apps start on infra reusables v2.0.0
detail: The managed ci.yml gives the test job `contents: read`, `packages: read` and `pull-requests: read`, which the v2 reusable test workflow asks for, and kumiko-create writes kumiko.deploy.infraRef reusables-v2.0.0. Existing apps set infraRef to reusables-v2.0.0 and run kumiko sync-managed --write.
-->
