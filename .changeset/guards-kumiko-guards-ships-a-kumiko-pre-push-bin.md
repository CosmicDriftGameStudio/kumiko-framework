---
"@cosmicdrift/kumiko-guards": minor
---

kumiko-guards ships a kumiko-pre-push bin carrying the shared pre-push hook mechanics

Consumer repos can replace their vendored .husky/pre-push with a thin shim; a tracked, executable scripts/pre-push-extra.sh is the per-repo extension point.

<!-- kumiko-changes
feature: guards
type: improvement
title: kumiko-guards ships a kumiko-pre-push bin carrying the shared pre-push hook mechanics
-->
