---
"@cosmicdrift/kumiko-repo-manifest": patch
---

repo-manifest: the root-containment check also resolves wildcard segments. A symlink such as `packages/evil -> /` matched by `packages/*/src` is now rejected; before, only the static prefix before the first glob segment was checked. Segments below a `**` are still not walked, so glob consumers must not follow symlinks inside such a tree.

<!-- kumiko-changes
feature: repo-manifest
type: breaking
title: manifest patterns reject symlinks escaping the repo root behind wildcard segments
migration: |
  A kumiko.json whose wildcard pattern matches a symlink that leaves the repo root now fails to load. Point the pattern at paths inside the repo or remove the symlink.
-->
