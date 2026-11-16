---
"@cosmicdrift/kumiko-guards": minor
---

Ratchet guards fail on every unfrozen finding when their baseline file is missing, in consumer repos as well.

<!-- kumiko-changes
feature: guards
type: breaking
title: Ratchet guards fail without a baseline file
detail: Every baseline ratchet (As-Casts Audit with its suspect and legit baselines, File Size, Complexity Check, Data-Testid Guard, ignore-tag-reason, comment-issue-ref-only, Tailwind-Scan-Surface Guard, security-plugin-suppression, guard-raw-sql, guard-integration-mocks, Runtime-Isolation Check) treats a missing baseline file as an empty baseline. Each existing finding is a violation until the repo freezes its current state; before, a repo without the file only got a console warning and the ratchet had no effect. Without a baseline file the As-Casts Audit now also fails on unknown `@cast-boundary` reasons. The `failClosed` option of `baselineRatchet` is removed because it is now the only behavior.
migration: Freeze the current state once per failing ratchet and commit the written `.kumiko-*-baseline.json` files: `bunx kumiko-guards guards --write-baseline --guard=<name>` for AST guards (for example `--guard="As-Casts Audit"`, `--guard="File Size"`, `--guard="Complexity Check"`, `--guard=ignore-tag-reason`) and `bunx kumiko-guards checks --write-baseline --guard=<name>` for repo checks (`guard-raw-sql`, `guard-integration-mocks`). Each violation names the missing baseline file. Ratchets without findings need no file.
-->
