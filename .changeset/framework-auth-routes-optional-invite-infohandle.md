---
"@cosmicdrift/kumiko-framework": minor
---

auth-routes: optional invite.infoHandler mounts POST /auth/invite-info

InviteConfig gained an optional infoHandler (qualified query-handler name). When set, createAuthRoutes mounts POST /auth/invite-info, dispatching the query anonymously and returning {isSuccess:true, email, hasAccount} or the query's serialized error.

<!-- kumiko-changes
feature: framework
type: improvement
title: auth-routes: optional invite.infoHandler mounts POST /auth/invite-info
migration: |
  No action needed: infoHandler is optional and existing invite configs without it are unaffected — the route simply isn't mounted.
-->
