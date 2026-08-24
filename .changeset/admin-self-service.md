---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Admin self-service: TenantAdmin may mutate membership roles only in their own session tenant (`updateMemberRoles`), with elevation rules that forbid self-elevate and assigning a role above the actor; SystemAdmin global user-role edits share the same elevation guard, last-admin protection, audit events, and session invalidation.
