---
"@cosmicdrift/kumiko-framework": patch
---

kumiko-upgrade: --resolve refuses --dry-run, version detection handles prerelease pins and workspace members

<!-- kumiko-changes
feature: framework
type: fix
title: kumiko-upgrade --resolve rejects --dry-run, and the installed version is found from workspace members and prerelease lockfile pins
detail: kumiko-upgrade --resolve --dry-run used to write the marker anyway; it now exits with an error and writes nothing. The installed version is now looked up from the working directory up to the repo root (the first directory with .git or a package.json with workspaces), so running inside a workspace member of a hoisted-linker monorepo finds it, while a parent workspace outside the repo is still ignored. bun.lock pins like 0.364.0-next.1 resolve to their x.y.z core instead of being dropped.
-->
