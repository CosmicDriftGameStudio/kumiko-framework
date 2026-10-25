---
"@cosmicdrift/kumiko-feature-ast": patch
---

Codemods run on machines without git, such as the customer-app builder image.

<!-- kumiko-changes
feature: feature-ast
type: fix
title: Codemods no longer fail when git is not installed
detail: collectSourceFiles asks git check-ignore which files the repository's .gitignore excludes. Without a git executable Bun.spawnSync threw ENOENT and kumiko-upgrade --apply aborted at the first codemod, for example ctx-namespaces in the customer-app builder image. A missing git is now treated like a directory outside a repository: no file is filtered.
-->
