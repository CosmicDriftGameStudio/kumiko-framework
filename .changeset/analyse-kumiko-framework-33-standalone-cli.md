---
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-dev-server": patch
---

Add runStandaloneCli, one dispatcher for schema, consumer and events in the bundled kumiko CLI; new apps scaffold bin/kumiko.ts with it.

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: runStandaloneCli for bin/kumiko.ts
detail: @cosmicdrift/kumiko-server-runtime/standalone-cli exports runStandaloneCli(argv, appCwd, out, { features, envSchema, rowLevelSecurity? }). It dispatches `schema`, `consumer` and `events`, joins the KMS slots of the app env schema with kmsEnvSchema for the rebuild after `schema apply`, and passes rowLevelSecurity to schema and events. The scaffolded bin/kumiko.ts is now a call to it with process.exitCode, so apps no longer drift on which commands and options the production CLI supports.
-->
