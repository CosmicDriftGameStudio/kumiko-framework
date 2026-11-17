---
"@cosmicdrift/kumiko-guards": minor
"@cosmicdrift/kumiko-testing": minor
---

Direct env writes in tests are ratcheted; `withEnvForEachTest` and `withEnvForSuite` set env around tests.

<!-- kumiko-changes
feature: guards
type: breaking
title: test-env-writes ratchet and suite env helpers
detail: The new guard `test-env-writes` counts direct writes to `process.env` and `Bun.env` in test files (assignment, `delete`, `Object.assign`) and freezes them in `.kumiko-test-env-writes-baseline.json`. `@cosmicdrift/kumiko-testing/helpers` adds `withEnvForEachTest(overrides)` and `withEnvForSuite(overrides)`, which set and restore env per test or per describe block; register them before any `beforeAll` that reads the env.
migration: Run `kumiko-guards guards --write-baseline --guard="test-env-writes"` once, then move direct writes to `withEnv`, `withEnvForEachTest` or `withEnvForSuite`.
affects: process.env, Bun.env
-->
