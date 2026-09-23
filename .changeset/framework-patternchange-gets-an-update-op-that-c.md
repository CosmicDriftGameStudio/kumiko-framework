---
"@cosmicdrift/kumiko-framework": minor
---

PatternChange gets an update op that changes individual handler header fields (access, rateLimit, description, agent, escapeHatch, unsafeSkipTransitionGuard) without resending schema or handler bodies

applyChanges/updatePattern edit only the named properties of a write/query/stream handler's inline object literal; bodies, comments and all other properties stay byte-identical. parsePatternChanges validates set/unset per handler kind with exact paths (access cannot be unset). escapeHatch.reason must now be non-empty in PatternChange input, matching the boot validator.

<!-- kumiko-changes
feature: framework
type: improvement
title: PatternChange gets an update op that changes individual handler header fields (access, rateLimit, description, agent, escapeHatch, unsafeSkipTransitionGuard) without resending schema or handler bodies
-->
