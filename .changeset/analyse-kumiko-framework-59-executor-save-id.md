---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
---

`create`, `update` and `restore` of the event-store executor return a string `id`.

<!-- kumiko-changes
feature: event-store
type: improvement
title: Executor save results carry a string id
detail: The event-store executor only runs uuid aggregates, yet `create`, `update` and `restore` returned `SaveContext` with `id: number | string`, so handlers cast `result.data.id as string` before passing the id on. They now return `ExecutorSaveContext` with `id: string`; the casts can go. `SaveContext` itself and the id types of the verb payloads are unchanged.
-->
