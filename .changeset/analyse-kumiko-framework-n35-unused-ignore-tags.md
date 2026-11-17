---
"@cosmicdrift/kumiko-guards": minor
---

Guard runs fail on kumiko-lint-ignore markers that suppress nothing.

<!-- kumiko-changes
feature: guards
type: breaking
title: Unused kumiko-lint-ignore markers fail the guard run
detail: Every guard that honours a `kumiko-lint-ignore <slug>` marker records each marker it consumed. After the run, the new `unused-ignore-tags` check reports every marker of a guard that ran whose spot produced no finding, for example markers above header titles that i18n-ui-strings already exempts. Placeholders such as `<reason>` in doc comments are skipped. File-wide `kumiko-lint-ignore-file` markers and comment-lang, comment-issue-ref-only, raw-sql and secret-literals markers are not checked.
migration: Run the guards and delete every marker the `unused-ignore-tags` check reports. A marker belongs only where its guard would otherwise report a finding.
affects: kumiko-lint-ignore
-->
