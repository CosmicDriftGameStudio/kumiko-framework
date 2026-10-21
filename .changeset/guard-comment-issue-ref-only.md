---
"@cosmicdrift/kumiko-guards": minor
---

New Comment Issue-Ref guard fails on comments that hold only an issue reference or a planning label.

<!-- kumiko-changes
feature: guards
type: improvement
title: Comment Issue-Ref guard
detail: The comment-issue-ref-only guard flags comments that consist only of an issue or PR reference or a planning label (`#1234`, `fw#1234`, `Phase 3`, `S2.H1`) with no explanatory word besides it. Consecutive own-line `//` comments count as one paragraph, so a reference at the end of an explaining paragraph passes. Hits are frozen per file in `.kumiko-comment-issue-ref-baseline.json` and may not grow; without the baseline file the guard only warns. Deliberate exceptions take `// kumiko-lint-ignore comment-issue-ref-only <reason>`.
migration: Optional. Freeze existing hits with `kumiko-guards guards --write-baseline --guard=comment-issue-ref-only`.
-->
