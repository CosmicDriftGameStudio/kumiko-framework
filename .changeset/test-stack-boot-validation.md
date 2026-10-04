---
"@cosmicdrift/kumiko-framework": minor
---

`setupTestStack` now validates nav, workspace and tree-action references on the mounted features, with the same error messages as the prod boot. References into features that are not mounted are skipped. The new option `validateBoot: "full"` runs the complete `validateBoot`, including the screen and ref-entity checks that span features; give apps one boot test with their prod feature composition and this option.

<!-- kumiko-changes
feature: framework
type: improvement
title: Test stacks validate nav references and can run the full boot validation
-->
