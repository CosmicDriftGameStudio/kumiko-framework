---
"@cosmicdrift/kumiko-cli": patch
---

`kumiko new app` scaffolds the same app as `bun create kumiko-app --yes`.

<!-- kumiko-changes
feature: cli
type: improvement
title: kumiko new app scaffolds the recommended feature set
detail: `kumiko new app <name> [--blank]` runs the scaffold of `bun create kumiko-app <name> --yes`: the recommended features from the feature manifest, the demo tasks (none with --blank) and the same next steps. Before, it scaffolded a smaller app through a separate code path.
-->
