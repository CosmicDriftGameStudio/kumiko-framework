---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-testing": patch
"@cosmicdrift/kumiko-guards": patch
"@cosmicdrift/kumiko-dev-server": minor
"@cosmicdrift/kumiko-cli": minor
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
---

Consumer findings from the second rollout wave

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: Default mail resolveEmail finds users of any tenant
detail: The default resolveEmail of the mail boot option loads the user by id only. Rows in read_users carry the system tenant, so the former tenantId filter returned null for every real tenant.
-->

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: extraContext factories see the boot env, billing hook and new exports
detail: The merged env, including the defaults of declarative boot options such as FILE_STORAGE_PROVIDER from fileStorage, is passed to extraContext factories as env. resolveBillingOption, parseRunMode, HostDispatchFn, buildDemoModeRoute and withDemoReadOnlyFetch are exported from the package index. The billing boot option accepts afterSync.
-->

<!-- kumiko-changes
feature: file-provider-s3
type: improvement
title: S3 endpoint over http outside production
detail: s3EndpointSchema rejects http on non-loopback hosts only when NODE_ENV=production, so compose hostnames such as minio work in smoke setups.
-->

<!-- kumiko-changes
feature: auth-foundation
type: improvement
title: Boot warning when anonymous routes run without anonymousAccess
detail: A boot warning names anonymousAccess when host-routing, managed-pages or legal-pages is mounted without it; anonymous requests get no tenant until the option is set.
-->

<!-- kumiko-changes
feature: billing-foundation
type: improvement
title: Billing webhook sync exposes afterSync
detail: The billing webhook sync calls afterSync({ tenantId, tier, changed, event }) after every webhook, with changed false when the tier stayed the same.
-->

<!-- kumiko-changes
feature: delivery
type: improvement
title: Unsubscribe endpoint answers form posts with an HTML page
detail: POST on the delivery unsubscribe route returns an HTML confirmation page for a form post and JSON for a bare POST. The behavior is unchanged; this only documents it.
migration: Clients that post the unsubscribe form expect HTML, API clients that post without a form content type expect JSON. No code change is needed.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: Dry-run env table and boot check respect required overrides and the fileStorage default
detail: The env table of KUMIKO_DRY_RUN_ENV=boot shows a variable as required when the app schema overlays required() on an optional field, and the error says required. The schema-cli boot check applies runProdApp's fileStorage default instead of demanding FILE_STORAGE_PROVIDER.
-->

<!-- kumiko-changes
feature: testing
type: improvement
title: Scaffold test:dom passes without test files
detail: The scaffold sets test:dom to pass without test files and adds the devDependencies @testing-library/react, @testing-library/dom and @happy-dom/global-registrator.
-->

<!-- kumiko-changes
feature: guards
type: improvement
title: Pre-push shim stops at the repo boundary, nearest kumiko.json wins, process.env guard covers bin
detail: The pre-push shim searches upward only through ancestors up to the git root and fails with a message when nothing is found. findLocalRepo prefers the nearest kumiko.json over the git root. guard-no-direct-process-env scans bin/**/*.ts including bin/ops.
-->

<!-- kumiko-changes
feature: dev-server
type: improvement
title: composeGdprStack access, composePagesStack terms, migrate-step project name
detail: composeGdprStack({ access }) is passed to compliance-profiles and composeOpsStack({ access }) to delivery as their handler roles. composePagesStack({ terms }) is passed to legal-pages. DevHostDispatch and DevHostDispatchResult are exported. The migrate-step.sh template and the managed pre-push template follow the show-pony version, with the compose project name taken from docker compose config.
-->

<!-- kumiko-changes
feature: cli
type: improvement
title: kumiko codemod lists and runs codemods
detail: kumiko codemod lists the codemods without a name. kumiko codemod <name> runs one against the current directory as a dry run and applies it with --write.
-->

<!-- kumiko-changes
feature: renderer
type: improvement
title: Missing-screen page spaces title and hint like other cards
detail: The page-not-available card renders title and hint through the Card title and subtitle slots.
-->

<!-- kumiko-changes
feature: locale-de
type: improvement
title: errors.demoReadOnly translated
detail: The read-only demo error has German copy in the informal and formal catalogs.
-->

<!-- kumiko-changes
feature: locale-es
type: improvement
title: errors.demoReadOnly translated
detail: The read-only demo error has Spanish copy.
-->
