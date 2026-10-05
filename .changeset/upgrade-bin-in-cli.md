---
"@cosmicdrift/kumiko-cli": minor
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-guards": patch
---

`kumiko-upgrade` ships with kumiko-cli and reads the repo's own version

Repos that depend only on `@cosmicdrift/kumiko-cli` and `@cosmicdrift/kumiko-guards` now get the `kumiko-upgrade` bin, which the upgrade-state guard runs. The installed version comes from the repo itself: its `node_modules`, the framework's package directories, then its `bun.lock`. It no longer walks up into a parent workspace, and with the isolated linker `installedVersion` is no longer `null`.

<!-- kumiko-changes
feature: cli
type: fix
title: kumiko-upgrade ships with kumiko-cli and takes the installed version from the repo's own install or bun.lock
-->
