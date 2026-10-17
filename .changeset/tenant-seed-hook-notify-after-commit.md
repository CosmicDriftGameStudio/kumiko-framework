---
"@cosmicdrift/kumiko-bundled-features": patch
---

Seed hooks in afterCommit phase notify through the after-commit notify factory and build their context lazily

<!-- kumiko-changes
feature: tenant
type: fix
title: Post-save seed hooks use the after-commit notify factory
detail: afterCommit seed hooks now get a notify function bound to the signup dispatcher's job runner when the dispatcher provides one, falling back to the regular factory. The afterCommit hook context is built only when the hook actually runs.
-->
