---
"@cosmicdrift/kumiko-guards": minor
---

`kumiko-guards comment-lang` runs the comment-language ratchet

The subcommand takes `--touched --base=<ref>`, `--list`, `--write-baseline` and `--no-baseline`. The pre-push hook calls it instead of the separate `kumiko-guard-comment-lang` bin.

<!-- kumiko-changes
feature: guards
type: improvement
title: New kumiko-guards comment-lang subcommand replaces the kumiko-guard-comment-lang bin
-->
