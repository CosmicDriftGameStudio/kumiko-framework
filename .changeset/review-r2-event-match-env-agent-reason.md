---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Review round 2 fixes for waitForEvent matching, read steps, env parsing and agent reasons.

- A pending workflow row with a malformed or unsupported `matchExpr` is now skipped and logged instead of aborting the wakeup projection for every other run waiting on the same event. `evaluateEventMatch` reports a structurally malformed AST as a readable `Malformed EventMatch` error.
- `read.findOne` and `read.findMany` reject a non-object `unsafeAllTenants` (for example `true`) with an `InternalError` instead of a raw `TypeError`.
- `parseEnv` reports a refinement that throws as a `KumikoBootError`, and the ciphertext-only slot caveat for refinements is documented.
- Removed the unused `AgentReasons.permissionDenied` (`agent.permission_denied`) reason and its error-docs pages; nothing emitted it.

<!-- kumiko-changes
feature: framework
type: fix
title: Malformed waitForEvent matchExpr rows are skipped instead of blocking the wakeup projection
-->

<!-- kumiko-changes
feature: framework
type: breaking
title: AgentReasons.permissionDenied removed
migration: |
  Drop references to `AgentReasons.permissionDenied` / `"agent.permission_denied"`. The framework never emitted this reason.
-->
