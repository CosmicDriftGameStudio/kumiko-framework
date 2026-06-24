---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Add a read-time backstop against reserved tenant-membership roles. The write paths already reject `system`/`SystemAdmin`/`all`/`anonymous` from memberships at command time, but command-time validation does not survive an event-sourcing projection rebuild: replaying a stored `tenant-membership.created` event goes through the apply path, not the handler, so a membership role that was forbidden when written could be resurrected into the projection.

`stripForbiddenMembershipRoles` (new, exported from `@cosmicdrift/kumiko-framework/engine`) filters reserved roles out of the membership portion at every JWT mint that derives roles from a membership — login, switch-tenant, invite-accept, and invite-signup-complete. `globalRoles` (where `SystemAdmin` legitimately lives) is never filtered, so real platform admins are unaffected. The forbidden-role set is now the single source of truth in the engine; `bundled-features` re-exports `findForbiddenMembershipRole` from it.
