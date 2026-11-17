---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

Retrying a failed run of a per-tenant or event-triggered job is refused instead of starting the job for every tenant or with an empty payload.

<!-- kumiko-changes
feature: jobs
type: fix
title: jobs:write:retry refuses runs it cannot repeat faithfully
detail: A run row records neither the tenant of a perTenant child run nor the event payload of an event-triggered run. `jobs:write:retry` used to dispatch such runs again anyway: a perTenant job fanned out to every active tenant, an event-triggered job ran with an empty payload. It now fails with 422 and the reason `job_not_retryable` for jobs declared `perTenant` or triggered by `on`. A run whose job no longer exists fails with 404 `job_not_found` instead of a 500. Manual, cron and maintenance jobs retry as before.
-->
