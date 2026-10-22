---
"@cosmicdrift/kumiko-framework": patch
---

`kumiko-upgrade` without `--apply` now says that the upgrade CHANGELOG and the marker are only written by `--apply`, whenever changes are pending or the marker is behind the installed version.

<!-- kumiko-changes
feature: framework
type: fix
title: kumiko-upgrade explains that --apply writes the CHANGELOG
detail: The preview run never wrote the upgrade CHANGELOG or the marker, and consumers running it without --apply got no entry and no explanation. It now prints a hint; the exit code is unchanged.
-->
