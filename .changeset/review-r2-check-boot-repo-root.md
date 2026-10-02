---
"@cosmicdrift/kumiko-cli": patch
---

`kumiko check` now runs the boot validation against the repo root instead of the current directory, so running it from a subdirectory no longer reports a missing `kumiko/schema.ts`.

<!-- kumiko-changes
feature: cli
type: fix
title: kumiko check runs boot validation against the repo root when started from a subdirectory
-->
