---
"@cosmicdrift/kumiko-guards": minor
---

A ratchet baseline that allows more findings than exist now fails until it is tightened.

<!-- kumiko-changes
feature: guards
type: breaking
title: Ratchet baselines with headroom fail
detail: Every baseline ratchet (file size, complexity, raw SQL, runtime isolation, cast markers, ignore-tag reasons and the others) now reports a file whose current count is below its frozen count as a violation, next to regressions in the same run. Before, the lower count passed and the headroom let later findings in unnoticed. Baselines no longer carry `generated`, `total` or `totalSuspect`; existing files with these fields still load.
migration: After the bump run the guards, check that only "under baseline" violations appear, then freeze once with `--write-baseline` (guards, checks, UI guards and `bun kumiko-guards guards --write-baseline --guard="As-Casts Audit"`) and commit the baseline files.
affects: all
-->
