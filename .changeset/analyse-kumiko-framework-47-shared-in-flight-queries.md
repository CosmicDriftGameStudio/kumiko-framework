---
"@cosmicdrift/kumiko-renderer": patch
---

Identical useQuery calls that mount together send one request instead of one per component.

<!-- kumiko-changes
feature: renderer
type: improvement
title: useQuery shares an identical request that is already in flight on mount
detail: When a useQuery hook mounts or changes its type or payload, it joins a request for the same type and payload that is already running through the live dispatcher instead of sending its own, and every hook gets the same answer. `refetch()`, polling ticks and live refetches always send a new request, and a write or batch through the dispatcher ends the sharing, so data read after a mutation is never older than the mutation. The shared request is cancelled only when every hook waiting on it has unmounted or moved on. `dispatcher.query` takes the opt-in as `QueryOpts.shareInFlight`; calls without it behave as before. There is no cache: a hook that mounts after the request settled sends a new one.
-->
