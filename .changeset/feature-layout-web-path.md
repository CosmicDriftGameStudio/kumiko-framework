---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-guards": minor
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-document-designer": patch
---

The runtime of a feature file now follows from its path: `src/<feature>/web/**` is client code, everything else is server or isomorphic. The `@runtime` markers are gone from bundled-features and the document designer, and the isomorphic constants, i18n and name files moved under `web/`. Every existing export subpath stays valid and points at the new file.

<!-- kumiko-changes
feature: bundled-features
type: improvement
title: Client files of a feature live under web/
detail: Files that carried a runtime-client marker moved into <feature>/web/ (constants.ts, i18n.ts, qualified-names and similar), so the runtime-isolation guard reads the runtime from the path. Export subpaths such as ./tenant/constants are unchanged; only relative imports into the old file locations break. The web-side translation glue of user-data-rights, managed-pages, admin-shell, audit, jobs and the document designer is now web/default-translations.ts.
migration: Run bun kumiko-upgrade --apply, or bun kumiko codemod feature-layout . --write. It moves every file marked as runtime client from src/features/<feature>/ into src/features/<feature>/web/, rewrites the relative imports and drops the marker. Add --check to list what is left.
codemod: scripts/codemod/feature-layout.ts
-->

<!-- kumiko-changes
feature: guards
type: improvement
title: App-feature-structure guard flags runtime-client markers
detail: The guard reports a runtime-client marker in a feature file, outside web/ as client code in the server tree and inside web/ as redundant. dev/ is classified as the dev runtime by path.
-->
