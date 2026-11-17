---
"@cosmicdrift/kumiko-framework": patch
---

The SSE route limits open connections per signed-in user.

<!-- kumiko-changes
feature: framework
type: fix
title: SSE connections are capped per user
detail: `GET /api/sse` answers 429 with code `sse_connection_limit` once a signed-in user holds `SSE_MAX_CONNECTIONS_PER_USER` (10) open streams on the same server process; a closed stream frees its slot. Anonymous public viewers are not counted, since they share one user id; limit them at the ingress.
-->
