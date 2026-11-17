---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-framework": minor
---

The session check fails closed on lookup errors and rejects a session whose user lost the membership.

<!-- kumiko-changes
feature: sessions
type: breaking
title: Session check rejects removed members and no longer falls back to JWT roles on errors
detail: A user or membership lookup error now fails the request instead of returning live with the token's frozen roles. A user without a membership in the session's tenant gets 401 `session_invalid` with reason `not_a_member`. Principals without a user row (bootstrap actors) keep their token roles. The check and the PAT resolver share the new `resolveLiveTenantRoles` from the tenant feature.
migration: Tests with hand-built actors that have a user row but no membership in the tenant must seed a membership.
-->

<!-- kumiko-changes
feature: personal-access-tokens
type: breaking
title: PATs of principals without a user row are rejected
detail: The PAT resolver uses `resolveLiveTenantRoles`; a token whose user has no user row now gets the same 401 as an unknown token.
migration: None for apps; PATs are always created by existing users.
-->

<!-- kumiko-changes
feature: framework
type: breaking
title: AuthSessionStatus gains not_a_member
detail: `AuthSessionStatus` has the new member `not_a_member`; the middleware rejects it with 401 `session_invalid`.
migration: Exhaustive switches over `AuthSessionStatus` need a `not_a_member` branch.
-->
