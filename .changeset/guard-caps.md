---
"@cosmicdrift/kumiko-guards": patch
---

The complexity guard has a hard cap: a function above complexity 60 in the repo's own files always fails, whatever the baseline or a budget tag says. `check-complexity.ts --all` lists every hotspot instead of the first 30. The file-size threshold drops from 2000 to 1200 lines.

<!-- kumiko-changes
feature: guards
type: improvement
title: Complexity hard cap, --all, file-size threshold 1200
detail: Functions with complexity above 60 are a violation in the repo's own files, independent of the complexity baseline and of the complexity-budget tag, also with --no-baseline. The report lists them in their own section. `bun check-complexity.ts --all` prints all hotspots in the standalone run, --write-baseline and --no-baseline. The file-size guard now freezes files above 1200 lines instead of 2000.
migration: Consumer repos without a complexity baseline get a hard error for functions above complexity 60; split them. File size stays a warning there without a baseline; with one, files between 1200 and 2000 lines count as new hits until `--write-baseline` is run.
-->
