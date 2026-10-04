---
"@cosmicdrift/kumiko-bundled-features": patch
---

Webhook dispatch releases the connection right after the status

The step-dispatcher only needs the response status, so it now cancels the unread response body instead of leaving the socket open until the 10 s request timeout fires.

<!-- kumiko-changes
feature: step-dispatcher
type: fix
title: Webhook dispatch cancels the unread response body so a stalling receiver cannot hold the connection
-->
