---
"@cosmicdrift/kumiko-bundled-features": patch
---

Review follow-ups: the audit list cursor comment names the real 400 status, the `dispatchToolCall` JSDoc states that local validation errors carry no `code`, and the agent tool, audit, auth and billing integration tests gain coverage and isolation fixes.

<!-- kumiko-changes
feature: agent-tools
type: fix
title: dispatchToolCall documents which failures carry a code
detail: Only handler and dispatcher failures carry a code; local validation errors such as an unknown tool or bad arguments come back without one, and the JSDoc now says so.
-->

<!-- kumiko-changes
feature: audit
type: fix
title: Oversized audit cursor is documented as a 400 validation error
detail: The cursor pattern comment now names the validation error (400) the API actually returns instead of 422.
-->

<!-- kumiko-changes
feature: bundled-features
type: chore
title: Tests cover nested agent grants, erased subjects and anonymous change-password
detail: Integration tests now check that a delegating tool handler keeps the cross-tenant-read marker closed, that an erased subject gets no consumer-protection mail, and that the anonymous change-password check runs once; the audit seed helper uses withEnv.
-->
