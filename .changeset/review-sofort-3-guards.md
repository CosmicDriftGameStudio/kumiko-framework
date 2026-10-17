---
"@cosmicdrift/kumiko-guards": patch
---

test-timeouts no longer flags identifier test bodies, push-root judges repo paths by their checkout, security baseline errors carry a readable detail

<!-- kumiko-changes
feature: guards
type: fix
title: guard-test-timeouts ignores identifier test bodies and timeout-free options; push-root no longer trusts a lookalike folder name
detail: An identifier passed as a test argument only counts as a timeout when its type is a number or has a timeout property, so Playwright's test(title, details, body) and options like { retry: 2 } pass. A push root that resolves to a git repo is judged by its canonical checkout name, not by its folder name. An unexpected security baseline shape keeps the reason unexpected_baseline_shape and adds a readable detail.
-->
