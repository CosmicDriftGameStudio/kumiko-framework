---
"@cosmicdrift/kumiko-dev-server": minor
"@cosmicdrift/kumiko-cli": minor
---

`kumiko check` verifies the timeout of every `bun test` script.

<!-- kumiko-changes
feature: dev-server
type: breaking
title: kumiko check verifies test script timeouts
detail: The scripts step of `kumiko check` reads every `bun test` command in package.json, derives its variant from `--config` and fails when the effective `--timeout` (bun's default is 5000) differs from `TEST_TIMEOUT_MS` of that variant. Running `bunfig.integration.toml` through `bun test` directly and `test:integration*` scripts that do not call `bun kumiko-testing integration` fail too. Apps that adopted `defineAppConfig` fail, others get a warning.
migration: Set `--timeout` to the class value (`test:dom` 5000, `test:real` 240000) and delete app-level copies of this check such as `bun-test-timeout.test.ts`.
affects: all
-->
