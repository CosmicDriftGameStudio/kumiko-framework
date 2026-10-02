---
"@cosmicdrift/kumiko-framework": minor
---

Anonymous callers on protected handlers get 401 unauthenticated, and a stale auth cookie no longer blocks public handlers

<!-- kumiko-changes
feature: framework
type: breaking
title: Anonymous callers on protected handlers get 401 unauthenticated, and a stale auth cookie no longer blocks public handlers
migration: |
  Tests or clients that expect 403 / access_denied for an anonymous caller (no session, the anonymousAccess user, or a JWT carrying only the anonymous role) on a role-gated or openToAll handler now get 401 / unauthenticated; update those assertions. Signed-in callers without the role still get 403 access_denied. With anonymousAccess wired, a request whose auth cookie fails verification or whose session is no longer live continues as anonymous outside /api/auth/* (public handlers answer 200, protected ones 401 unauthenticated) instead of failing with 401 invalid_token / session_invalid; bearer tokens and /api/auth/* keep the explicit 401.
-->
