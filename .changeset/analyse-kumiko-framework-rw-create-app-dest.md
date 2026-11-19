---
"create-kumiko-app": patch
---

`create-kumiko-app` accepts `--dest <dir>` to scaffold into a chosen directory.

<!-- kumiko-changes
feature: create-kumiko-app
type: improvement
title: create-kumiko-app --dest
detail: `bun create kumiko-app <name> --dest <dir>` scaffolds into `<dir>` (absolute or relative to the working directory) instead of `./<name>`. The "Next steps" output names the chosen directory in its `cd` line.
-->
