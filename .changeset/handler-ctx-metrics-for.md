---
"@cosmicdrift/kumiko-framework": minor
---

Handlers now get `ctx.metricsFor(featureName)`, a `MetricsHandle` bound to an explicit feature name instead of the dispatching handler's own feature. Shared/library code invoked from many features' `HandlerContext` can count its own stable `kumiko_<featureName>_x` metric instead of splintering into one metric per caller. Unlike `ctx.metrics`, an unregistered name here is a silent no-op rather than a throw — it's meant for error/catch-path counters in shared code, where a missing registration must not turn an already-swallowed error into a thrown one.

`buildMetricName` also now accepts kebab-case feature names (normalizing `-` to `_`), matching the feature-name casing used everywhere else (qualified-name segments, `defineFeature`) — this also fixes `r.metric()` on any feature whose name contains a hyphen, which previously threw at boot.
