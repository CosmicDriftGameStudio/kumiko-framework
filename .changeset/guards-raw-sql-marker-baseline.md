---
"@cosmicdrift/kumiko-guards": patch
---

A `// kumiko-lint-ignore raw-sql <reason>` marker only suppresses the raw-sql guard when its file and reason are listed in `.kumiko-raw-sql-baseline.json`, so every new or reworded exception shows up as a baseline diff in review.

<!-- kumiko-changes
feature: guards
type: improvement
title: Raw-sql markers must be listed in a baseline
detail: |
  `guard-raw-sql` counts the markers that suppress a blocking hit per file and reason and compares them with `.kumiko-raw-sql-baseline.json` in the repo root. A marker without a baseline entry, or with a changed reason, fails the check. Without a baseline file the guard only warns. `kumiko-guards checks --write-baseline --guard=guard-raw-sql` writes the file.
migration: |
  Consumer: `--write-baseline` einmal laufen lassen (`bunx kumiko-guards checks --write-baseline --guard=guard-raw-sql`) und die erzeugte `.kumiko-raw-sql-baseline.json` committen.
-->
