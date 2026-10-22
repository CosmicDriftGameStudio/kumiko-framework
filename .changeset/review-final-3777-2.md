---
"@cosmicdrift/kumiko-cli": patch
---

`kumiko handbuch build` now also refuses an `--out` that lies inside a source repo or equals one of the `--texts`, `--shots`, `--web-texts` or `--web-shots` directories.

<!-- kumiko-changes
feature: cli
type: fix
title: handbuch build no longer wipes its own inputs
detail: The out directory is deleted before the build, so it is now rejected when it sits inside the configured repo, a flow source repo or an input directory, not only when it contains one.
-->
