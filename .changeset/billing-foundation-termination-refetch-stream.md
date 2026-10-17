---
"@cosmicdrift/kumiko-bundled-features": patch
---

Termination record re-reads the stream after the provider call

<!-- kumiko-changes
feature: billing-foundation
type: fix
title: Termination record re-reads the stream after the provider call
detail: The cancel-at-provider call can take long, so the termination event is appended with a freshly fetched stream version instead of the one read before it.
-->
