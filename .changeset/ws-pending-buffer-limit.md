---
"@cosmicdrift/kumiko-framework": minor
---

WebSocket routes cap the bytes queued behind slow handlers

Frames that arrive while `onOpen` or an earlier `onMessage` is still running are queued in order. Their summed size is now limited to 1 MiB (`WEBSOCKET_PENDING_BUFFER_LIMIT_BYTES`, or the route's `maxMessageBytes` if larger); beyond that the socket closes with code 1013 and the queued frames are dropped.

<!-- kumiko-changes
feature: framework
type: improvement
title: WebSocket routes cap the bytes queued behind slow handlers
-->
