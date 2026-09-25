---
"@cosmicdrift/kumiko-framework": patch
---

Foreign-origin cookie on an anonymousAccess server is treated as anonymous, not 403

<!-- kumiko-changes
feature: framework
type: fix
title: Foreign-origin cookie on an anonymousAccess server is treated as anonymous, not 403
detail: |
  originMiddleware rejected any state-changing request whose cookie-carrying
  Origin (or Sec-Fetch-Site) fell outside auth.allowedOrigins with 403
  origin_not_allowed, including a logged-in tenant admin's own session cookie
  sent along by their public status page, which only makes anonymous queries.
  On servers with anonymousAccess wired, authMiddleware now drops such a
  foreign-origin cookie before jwt.verify and falls through to the anonymous
  flow; the token is never read. Servers without anonymousAccess, /api/auth/*
  paths and session-only httpRoutes keep the 403. No migration needed.
-->
