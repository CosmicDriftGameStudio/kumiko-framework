---
"@cosmicdrift/kumiko-server-runtime": minor
---

`runWorkerApp` takes the `unsubscribe` option, so `unsubscribe: true` mails that jobs in the worker process trigger carry the signed unsubscribe link and the List-Unsubscribe headers.

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: runWorkerApp accepts the unsubscribe option
detail: Pass the same `unsubscribe: { secret }` to runWorkerApp as to runProdApp; a job in the worker (e.g. a cron digest) that sends an `unsubscribe: true` notification then gets a signed link from `APP_BASE_URL`. The unsubscribe routes stay in the API process, which must use the same secret. Before, such mails went out without a link.
-->
