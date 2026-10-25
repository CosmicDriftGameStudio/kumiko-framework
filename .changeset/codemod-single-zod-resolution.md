---
"@cosmicdrift/kumiko-feature-ast": patch
---

The type-aware codemods (ctx-namespaces, remove-engine-payload-casts) resolve every zod import from the app root. An app that pins a different zod than the framework packages gets one nested zod per package, and the type checker then compared the app's schemas structurally against that copy at every framework call taking one. On a small app this took ctx-namespaces, run by kumiko-upgrade --apply, to 17 GB and 36 s. It now needs 1.1 GB and 3 s with the same rewrites.

<!-- kumiko-changes
feature: feature-ast
type: fix
title: Type-aware codemods no longer exhaust memory when the app pins another zod
detail: ctx-namespaces and remove-engine-payload-casts build their ts-morph project with a resolution host that resolves zod and its subpaths from the app root, so the program holds one zod copy even when bun nests a second version under each framework package. Without zod at the app root, resolution is unchanged. A small app with zod 4.6.6 next to framework packages on 4.6.7 went from 17 GB and 36 s to 1.1 GB and 3 s for ctx-namespaces, with the same rewrites.
-->
