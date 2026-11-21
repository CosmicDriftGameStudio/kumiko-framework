---
"@cosmicdrift/kumiko-bundled-features": patch
---

Connector inbound handling reads deleting folders in two queries and `runConnectorJobs` fails fast on a stack without a job runner.

<!-- kumiko-changes
feature: connectors
type: fix
title: Fewer queries per upload, clearer runConnectorJobs guard
detail: `deletingFolderIds` reads the deleting roots and then all folders of their connectors once instead of one query per root, and `receive-file` computes the set once per phase. `runConnectorJobs` also throws its `consumerLane` hint when the stack has no job runner. `postForm` and `sha256Hex` are exported from `connectors/testing`.
-->
