---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-dev-server": minor
"@cosmicdrift/kumiko-testing": minor
"create-kumiko-app": minor
"@cosmicdrift/kumiko-cli": patch
---

A scaffolded app boots without `DEMO_ADMIN_PASSWORD`: with `KUMIKO_BOOTSTRAP_ADMIN_EMAIL` set, the first start creates that person as an admin without a password, who then sets one through "forgot password". `bun create kumiko-app <name> --blank` scaffolds this starter without the demo tasks.

<!-- kumiko-changes
feature: auth-email-password
type: improvement
title: seedAdmin works without a password
detail: `SeedAdminOptions.password` is optional. Without it the account is created without a password hash and sets one through the password-reset flow. An existing account with the same email keeps its hash, as before.
-->

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: seeds.bootstrapAdminFromEnv creates the app creator as admin
detail: `runProdApp({ seeds: { bootstrapAdminFromEnv: true | { tenant, displayName, roles, globalRoles, emailVerified } } })` reads `KUMIKO_BOOTSTRAP_ADMIN_EMAIL` (optional, validated as an email in the env schema) and idempotently creates that account without a password, with the Admin and TenantAdmin roles in the tenant (`seeds.demoTenant` or the option's `tenant`), the SystemAdmin global role and a verified email. An empty variable seeds nothing. An existing account that already has a password (for example a self-registration with the same email) is left untouched: no verification, no membership, no role change; boot logs one warning without the email. It works next to `auth.admin`. Boot warns when the variable is set but neither `auth.passwordReset` nor `auth.mail` is configured, because the admin could never set a password.
-->

<!-- kumiko-changes
feature: server-runtime
type: fix
title: Boot seeds run under an advisory lock
detail: `applyStandardBootSeeds` holds a session advisory lock (`BOOT_SEEDS_LOCK_KEY`) while it seeds, for `runProdApp` and `runDevApp` alike. Two pods starting at the same time no longer race on add-only seeds such as the demo admin. The lock takes one pooled connection while the seeds run.
-->

<!-- kumiko-changes
feature: dev-server
type: improvement
title: scaffoldApp starter "blank"
detail: `scaffoldApp({ starter: "blank" })` (`SCAFFOLD_STARTERS`, `ScaffoldStarter`) writes an app without the tasks demo, `src/seed.ts` and `DEMO_ADMIN_PASSWORD`. `bin/main.ts` seeds the creator through `seeds.bootstrapAdminFromEnv` and wires SMTP mail and password reset when `SMTP_HOST` and `APP_BASE_URL` are set; `delivery` is mounted. The welcome banner prints only the email when the dev admin has no password. The default starter `demo` is unchanged.
-->

<!-- kumiko-changes
feature: testing
type: improvement
title: renderTestSetup starter "blank"
detail: `renderTestSetup({ starter: "blank" })` skips the tasks integration and e2e files, ships a boot validation unit test and a boot integration test, and runs Playwright with `--pass-with-no-tests`.
-->

<!-- kumiko-changes
feature: create-kumiko-app
type: improvement
title: --blank flag
detail: `bun create kumiko-app <name> --blank` scaffolds the blank starter: no demo tasks, no seeded password; the creator sets one through "forgot password" after the first start with `KUMIKO_BOOTSTRAP_ADMIN_EMAIL`.
-->

<!-- kumiko-changes
feature: auth-email-password
type: fix
title: Bootstrap admin seed is one-shot
detail: `seedBootstrapAdmin` skips when the target tenant already has another member (also a removed one), so a deleted owner or one who changed their email is not re-created as a passwordless SystemAdmin on the next boot. Our own passwordless account without membership is still completed, and the has-password skip now re-checks the row right before the grants.
-->
