---
"@cosmicdrift/kumiko-dev-server": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-guards": minor
"@cosmicdrift/kumiko-repo-manifest": minor
"@cosmicdrift/kumiko-cli": patch
"@cosmicdrift/kumiko-testing": patch
---

Managed workflows pin the infra reusables through `package.json#kumiko.deploy.infraRef` and have a public variant. `kumiko-upgrade --apply` writes a CHANGELOG.md. The pre-push bypass is gone. The testing preload reads the Meilisearch port from the app config.

<!-- kumiko-changes
feature: dev-server
type: improvement
title: Managed workflows take infraRef, visibility and app-* jobs
detail: ci.yml and release.yml render the infra reusables as @<infraRef> from package.json#kumiko.deploy.infraRef. Without it sync-managed renders @main and kumiko check managed warns; this warning becomes an error in a later release. kumiko.deploy.visibility "public" renders a self-contained ci.yml and a release.yml that only prints the gh workflow run hint for the public rollout. Jobs named app-* survive a sync and are not drift. kumiko.deploy.docStatusGuard false renders doc-status-guard false.
-->

<!-- kumiko-changes
feature: guards
type: improvement
title: The pre-push bypass is gone
detail: PRE_PUSH_SKIP no longer skips the hook, neither in the shipped hook nor in kumiko-pre-push. KUMIKO_CHECK_WT=1 only stops the hook from re-entering a wrapping scripts/check-wt.sh. The i18n-keys guard treats keys defined by installed @cosmicdrift packages as known.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: kumiko-upgrade writes CHANGELOG.md and shows manual entries with --verbose
detail: --apply adds one section per bump to CHANGELOG.md in the app (changed packages, breaking titles, manual migrations with status, codemods applied); a re-run of the same bump replaces its section. --verbose prints detail and migration of the open manual entries. A second --apply keeps the codemods already recorded in the marker. The biome-app preset allows console in bin and scripts. AppConfig takes an optional includeBundled flag that the managed kumiko/schema.ts uses to compose the bundled auth features.
-->

<!-- kumiko-changes
feature: repo-manifest
type: improvement
title: App port reader moves to repo-manifest/app-ports
detail: listAppPorts, findPortCollisions, scanWorkspaceApps and readStaticAppConfig are exported from @cosmicdrift/kumiko-repo-manifest/app-ports. dev-server managed-files re-exports the same names.
-->

<!-- kumiko-changes
feature: testing
type: fix
title: MEILI_URL in the test preload follows the app's Meilisearch port
detail: service-env-defaults derives MEILI_URL from ports.infra.meilisearch of the app's kumiko.config.ts when the variable is unset; without a configured port the old default stays.
-->

<!-- kumiko-changes
feature: cli
type: fix
title: kumiko ports and sync-managed use the shared port reader and print managed warnings
detail: kumiko ports reads from repo-manifest/app-ports; check managed and sync-managed print the infraRef warning.
-->
