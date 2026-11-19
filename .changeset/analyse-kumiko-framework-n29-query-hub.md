---
"@cosmicdrift/kumiko-renderer": patch
---

useQuery hooks with the same type and payload share one request and one result under a DispatcherProvider.

<!-- kumiko-changes
feature: renderer
type: improvement
title: useQuery shares one request and one result per query key
detail: All useQuery hooks under one DispatcherProvider with the same type and payload now read one shared state. Mounting joins a running request, polling ticks and live refetches send one request per key instead of one per hook, and refetch() called by several hooks in the same tick sends one request; a later refetch() aborts the running request and starts a fresh one. A refetch from any hook updates every hook on that key, and live events open one subscription per key. The state is held only while at least one hook is mounted, so there is no cache: returning to a screen loads fresh data. The new useQuery option `resultField` reads one top-level field of the answer, so several hooks can read different parts of one query result with one request.
-->
