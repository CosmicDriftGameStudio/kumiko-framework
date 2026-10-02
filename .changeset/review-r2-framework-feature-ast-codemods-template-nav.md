---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer": patch
---

Review round 2 fixes across the feature AST, codemods, the template-resolver and the renderer router.

- feature-ast: handler lookup falls back to the header when the body carries no match, a `zod` namespace import (`import * as z`) is recognised, and patch edits no longer overlap.
- Codemods: the PII heuristic matches segment-aligned names, the open-to-all codemod sets its exit code, and `failUnprocessable` calls are migrated.
- template-resolver: the row types and the public output now use the real base columns. `by-slug`, `by-tenant`, `list`, `find-by-id` and the `TemplateResource` API return `modifiedAt` (null until the first edit) instead of `updatedAt`, which was always undefined at runtime. The user-content export reads `modifiedAt` too.
- renderer: `formatPath` and `parsePath` encode and decode every path segment, so an entity id like `foo/bar` or `ä b` survives a round trip. A malformed percent-escape in the URL resolves to no route.

<!-- kumiko-changes
feature: template-resolver
type: breaking
title: TemplateResource and text-block/collection query outputs expose modifiedAt instead of updatedAt
migration: |
  Rename reads of `updatedAt` to `modifiedAt` on TemplateResource, the by-slug, by-tenant, list, find-by-id and collection queries, and the template-resolver web BlockSummary. The old field was never populated at runtime; the new one is an ISO timestamp, or null for a row that was never edited.
-->

<!-- kumiko-changes
feature: renderer
type: fix
title: Router paths encode and decode each segment, so entity ids with slashes or spaces round-trip
-->
