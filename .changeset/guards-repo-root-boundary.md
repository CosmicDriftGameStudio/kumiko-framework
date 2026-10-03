---
"@cosmicdrift/kumiko-guards": patch
---

Guards run inside a parent workspace (for example a `.wt/<repo>` worktree) no longer report files of neighbour repos. `buildSharedProject` keeps only source files under the local repo root, and the new `isOutsideRepoRoot` / `isExternalSourcePath` in the guard kit treat a file outside that root like a package under `node_modules`. `no-framed-extension-sections` uses it, so a workspace link that resolves into a neighbour repo is no longer followed. Local and CI runs now agree.

<!-- kumiko-changes
feature: guards
type: fix
title: Guards ignore neighbour repos of the parent workspace
detail: |
  The root comes from `findLocalRepo`, not a path heuristic. `isOutsideRepoRoot(filePath, repoRoot?)` compares real paths, so symlinks into a neighbour repo count as outside. `buildSharedProject` drops such files and `no-framed-extension-sections` stops following imports into them.
migration: |
  keine
-->
