---
"@cosmicdrift/kumiko-testing": patch
---

Testing helper fixes: barrier timeout, SSE CRLF, boundary guard on all pages, Redis connect cleanup.

<!-- kumiko-changes
feature: testing
type: fix
title: Barrier, SSE reader, boundary guard and Redis helper fixes
detail: createBarrier rejects late arrivals after a timeout instead of hanging. readSseFrames accepts CRLF and CR line endings. The error-boundary guard observes every page of the context and no longer fails on closed pages. createTestRedis disconnects the client when the initial connect fails. createE2eSeedRoutes of the e2e/seed-route subpath is also available as createE2eSeedRoutesWith, the old name stays as a deprecated alias.
-->
