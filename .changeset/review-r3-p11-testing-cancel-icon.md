---
"@cosmicdrift/kumiko-testing": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

`captureScreenshot(..., { fit: "content" })` ignores scroll containers whose overflow does not shrink when the viewport grows (textareas, fixed-height panes) instead of failing to converge. `kumiko-testing integration` no longer walks `node_modules` while discovering test files, and the seeded-tenant `apiAs` retries a failed login on the next call instead of replaying the cached error. The privacy-center and profile `cancel-deletion` actions declare the `x` icon instead of resolving to the destructive trash icon.

<!-- kumiko-changes
feature: testing
type: fix
title: captureScreenshot fit content ignores non-shrinking scroll containers, integration discovery skips node_modules, apiAs retries a failed login
-->

<!-- kumiko-changes
feature: user-data-rights
type: fix
title: cancel-deletion actions declare the x icon instead of resolving to the destructive trash icon
-->
