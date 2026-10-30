---
"@cosmicdrift/kumiko-renderer": patch
---

The web SSE client now reconnects when no frame (including the server's 15 s `ping`) arrives for 30 s, so a stream that stalls without an `error` event (KEDA interceptor) no longer leaves live lists stale.

<!-- kumiko-changes
feature: renderer
type: fix
title: SSE client reconnects after a stalled stream
detail: createEventSourceLiveEvents arms a 30 s watchdog (two missed server heartbeats) that is reset by open, ping and every entity or session-ended frame. On expiry it closes the connection and reconnects through the existing backoff path, which resyncs all listeners. The timer is cleared on close and error. The seam is the new stallTimers option.
-->
