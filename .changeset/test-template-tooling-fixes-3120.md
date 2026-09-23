---
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-guards": patch
"@cosmicdrift/kumiko-testing": patch
---

Fix scaffold boot, guard multi-repo roots, --write-baseline CLI and bunfig overwrite (#3120)

<!-- kumiko-changes
feature: dev-server
type: fix
title: Scaffolded docker-compose.yml uses the correct Postgres 18 data path; default app mounts auth-foundation so it boots
migration: |
  No action needed for existing apps; only newly scaffolded apps are affected.
-->

<!-- kumiko-changes
feature: guards
type: fix
title: AstGuard.run receives the caller's repo roots (guard-test-timeouts, guard-pii-annotations, guard-section-fields-raw, guard-text-field-stance, guard-i18n-locale-mount, guard-i18n-locale-terminology, check-complexity, guard-direct-fetch, guard-no-direct-fs, guard-write-handler-qns) so multi-repo aggregate runs stop throwing "cannot classify path" or dropping sibling-repo findings; --write-baseline now requires --guard=<name>
migration: |
  No action needed for AstGuard.run's new optional `roots` parameter. `kumiko-guards guards --write-baseline` no longer writes every ratchet guard's baseline in one call; pass `--guard=<name>` to freeze one guard deliberately, or run it once per guard.
-->

<!-- kumiko-changes
feature: testing
type: fix
title: kumiko-testing bunfig merges app-owned sections (e.g. install.scopes) back in and only aborts, naming the key, when a managed [install]/[test] section has a key the template doesn't emit; e2e seed routes gain an isE2eSeedingEnabled() export so a custom server entry can skip mounting them in prod
migration: |
  If `kumiko-testing bunfig` exits 1 naming a section.key (e.g. test.concurrency), remove or rename that key, or move it out of [install]/[test], then rerun. If your server entry mounts createE2eSeedRoutes() directly instead of using e2e/server.ts, guard the mount with isE2eSeedingEnabled() so prod never registers the seed routes.
-->
