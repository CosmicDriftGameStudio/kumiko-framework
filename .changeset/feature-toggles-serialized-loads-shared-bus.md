---
"@cosmicdrift/kumiko-bundled-features": patch
---

Feature-toggle snapshot loads are serialized and createFeatureToggleRuntime can share the server's cache-sync bus

<!-- kumiko-changes
feature: feature-toggles
type: fix
title: Overlapping toggle refreshes no longer drop a flip, and the runtime can reuse the server cache-sync bus
detail: initialize() and refresh() now run one snapshot load at a time, so a flip applied while a second load is in flight is kept instead of being overwritten by older rows. createFeatureToggleRuntime takes an optional fourth cacheSyncBus argument; with it no second bus (and no extra Redis connections) is created and close() leaves the shared bus open.
migration: Pass the server's cache-sync bus as the fourth argument of createFeatureToggleRuntime to avoid the additional Redis publisher and subscriber connections of the default bus; without it the runtime still builds and closes its own bus.
-->
