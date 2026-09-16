---
"@cosmicdrift/kumiko-guards": patch
---

Fix two false-positive findings in the Secret-Literal and Thin-Wrappers guards

The Secret-Literal Guard flagged secret-fallback patterns documented inside comments: only line-start `//` comments were skipped, so a block-comment line (JSDoc-style `*`, `/*`, `*/`) explaining the rule tripped the guard on its own documentation. Block-comment lines are now recognized as comments too. The Thin-Wrappers Guard misread `/regex/.test(x)` as a call to a function literally named `test`, reporting the enclosing function as a thin wrapper around it. That misclassification no longer fires.

<!-- kumiko-changes
feature: guards
type: fix
title: Fix two false-positive findings in the Secret-Literal and Thin-Wrappers guards
-->
