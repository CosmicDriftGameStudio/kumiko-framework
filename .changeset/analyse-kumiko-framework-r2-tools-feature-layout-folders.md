---
"@cosmicdrift/kumiko-feature-ast": patch
---
The feature-layout codemod also moves root jobs, entities and the client entry into their folders.
<!-- kumiko-changes
feature: feature-ast
type: improvement
title: feature-layout moves jobs, entities and client.ts
detail: `kumiko codemod feature-layout` now moves `<name>.job.ts` from the feature root to `handlers/`, `entity.ts` and `<name>.entity.ts` to `schema/`, and a root `client.ts` that defines a `ClientFeatureDefinition` to `web/index.ts`, rewriting every import. A `write.ts` or `queries.ts` with several handlers is reported for a manual split into one file per handler. `--check` now also fails while a move is pending. Baselines keyed by file path have to be frozen again after the moves.
-->
