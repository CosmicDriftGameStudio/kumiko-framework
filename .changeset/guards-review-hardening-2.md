---
"@cosmicdrift/kumiko-guards": patch
---

Guards are stricter and more consistent: `guards --guard=<name>` without `--write-baseline` is rejected instead of silently running every guard, the raw-form-HTML check also catches tags after `=`, `[` or in spaceless ternaries, the German locale check flags lowercase "organisation", `test-timeouts` flags `setDefaultTimeout` and `describe.configure({ timeout })`, the no-framed-extension-sections guard correlates registry keys and usages by resolved value, and the fake-tests helper lookup is scope-aware. UI guards report repo-relative file paths. The pre-push worktree detection compares absolute git dirs.

<!-- kumiko-changes
feature: guards
type: improvement
title: Guards reject --guard without --write-baseline and catch more raw-form-HTML, locale and timeout cases
-->
