---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-testing": patch
---

Test stack setup split into storage, services and server files; drain-jobs backlog test bound to the dispatcher batch size.

<!-- kumiko-changes
feature: testing
type: fix
title: test stack setup split, drain-jobs regression bound to the batch size
detail: The test stack setup moved from one 694-line file into test-stack-storage.ts, test-stack-services.ts and test-stack-server.ts without behaviour change. The drain-jobs row-level-security regression derives its backlog from `DEFAULT_EVENT_DISPATCHER_BATCH_SIZE` (newly exported from `@cosmicdrift/kumiko-framework/pipeline`) instead of a fixed 450, so it keeps covering "more than two batches" when the batch size changes. The seeded-tenant fixture documents that the per-test client IP header forces a CORS preflight on cross-origin requests. The use-all-bundled admin session file is cleared by a Playwright globalSetup, so a reused runner pid never serves expired cookies.
-->
