---
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-feature-ast": patch
"create-kumiko-app": patch
---

The dev server measures file changes against the filesystem clock, drops closed reload clients and kills the Tailwind watcher when boot fails; the feature-ast codemods report the forms they cannot rewrite and skip needless work.

<!-- kumiko-changes
feature: framework
type: fix
title: dev-server watcher, reload and boot cleanup; feature-ast codemod coverage
detail: The dev-server file watcher takes its restart baseline from a probe file's mtime instead of Date.now(), so coarse or skewed filesystem clocks no longer swallow real schema edits. A cancelled /_reload stream removes its own client from the hub. A failed createKumikoServer boot kills the Tailwind --watch child it already started. The feature-ast-package codemod reports `export *`, element-access and destructuring reads of the old engine namespace, and dynamic import or import-type of the old module as manual sites, and skips the source walk for packages that already declare feature-ast. The ctx-namespaces codemod reports a structural context type that other parameters, mocks or references also use instead of rewriting it half way, and caches the per-parameter analysis. collectSourceFiles keeps honouring .gitignore per file when a submodule path makes the batch `git check-ignore` fail.
-->
