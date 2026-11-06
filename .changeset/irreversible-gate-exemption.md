---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-feature-ast": minor
---

The irreversible-operation gate now refuses `executor.forget`, hard deletes, `kms.eraseKey` and writes to `readAsInstruction` fields in any request scope without a write-handler entry. Jobs and multi-stream projections can declare `irreversibleWithoutEntryHandler`; afterCommit and afterRollback hooks, HTTP routes, WebSocket handlers and agent tool calls cannot and never inherit the declaration.

<!-- kumiko-changes
feature: framework
type: breaking
title: Irreversible operations without a write-handler entry need a declared exception
detail: A job (`r.job`) or multi-stream projection that runs an irreversible operation without a write-handler entry now throws AccessDeniedError (`irreversible_operation_without_entry_handler`) instead of passing silently. Declare `irreversibleWithoutEntryHandler` with one of `rebuildable-derived-data`, `high-risk-or-cron-pipeline` or `per-dispatch-record-key`. The declaration covers only the job's or consumer's own code; afterCommit hooks, nested dispatches and agent tool calls inside it are still gated. Any other request scope without a write-handler entry is refused too: an afterCommit or afterRollback hook of an HTTP write, an HTTP route, a WebSocket handler. A refused job goes red and a refused consumer goes to the dead letter, while a refused hook is only logged, so its delete does not happen and only the log shows it.
migration: Add `irreversibleWithoutEntryHandler: "<case>"` to each job or multi-stream projection that calls executor.forget, a hard delete, kms.eraseKey or writes a readAsInstruction field. Pick the case that names why no entry handler exists; if none fits, route the operation through a write handler with `agent: { risk: "high" }`. Hooks and routes that call one of these primitives directly must dispatch such a handler or a job instead.
-->
