---
"@cosmicdrift/kumiko-cli": patch
"@cosmicdrift/kumiko-repo-manifest": patch
---

`kumiko check` counts a step that throws as a failure and still runs the remaining steps, and `--explain` now returns the guards' exit code. The `agent`, `consumer` and `project` commands report a readable message when `kumiko.config.ts` has no default export with a `features` array instead of crashing. Invalid-manifest errors name the root as `<root>` instead of an empty path.

<!-- kumiko-changes
feature: cli
type: fix
title: kumiko check survives throwing steps, config loading validates its shape
-->
