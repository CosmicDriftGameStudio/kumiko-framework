---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

A stale auth cookie on the SSE stream ends the web session with a session-ended frame

<!-- kumiko-changes
feature: framework
type: fix
title: A stale auth cookie on the SSE stream ends the web session with a session-ended frame
detail: With anonymousAccess, a stale or revoked auth cookie downgrades /api/sse to an anonymous 200, so the web client never noticed the session end and live updates stopped silently. The stream now opens with a session-ended frame carrying the rejection code and expires the auth cookies; the renderer-web live-events client calls onSessionEnded once for it.
-->
