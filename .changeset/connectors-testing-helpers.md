---
"@cosmicdrift/kumiko-bundled-features": patch
---

Apps can pair a satellite device, upload a file and run the resulting jobs in their integration tests.

<!-- kumiko-changes
feature: connectors
type: improvement
title: Test helpers for satellite pairing and file upload
detail: `@cosmicdrift/kumiko-bundled-features/connectors/testing` exports `pairConnectorDevice(stack, admin, { name?, basePath? })` (returns `{ token, connectorId }`), `uploadConnectorFile(stack, token, { path, bytes, sha256?, mtime? }, { basePath? })` (returns the `Response`) and `runConnectorJobs(stack)` (dispatches events and drains the job queue). The test stack must mount `createConnectorRoutes()` as `extraRoutes` and `jobs: { consumerLane: "worker" }`; a custom route `basePath` is passed to the helpers too. `pairConnectorDevice` and `runConnectorJobs` throw a hint when the stack lacks either.
-->
