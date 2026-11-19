---
"@cosmicdrift/kumiko-testing": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

A fresh demo app passes `kumiko check` again: its run-config test asserts the task handlers by name, and template-resolver labels the fields of `create-variant`.

<!-- kumiko-changes
feature: testing
type: fix
title: Fresh apps pass the weak-assertions guard and the agent lint
detail: The demo starter's `src/__tests__/run-config.test.ts` checked the task handlers only with `toBeDefined()`, so the `weak-assertions` guard failed a new app that has no baseline yet. It now asserts that the registered write and query handler names contain the task handlers. template-resolver's `create-variant` handler had no field labels, which made `kumiko agent lint` fail in every app that mounts template-resolver; it now ships labels in en, de and es.
-->
