---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-dev-server": minor
---

InboundMailContext exposes metricsFor to provider plugins

<!-- kumiko-changes
feature: inbound-mail-foundation
type: feature
title: InboundMailContext exposes metricsFor to provider plugins
detail: InboundMailContext gains an optional metricsFor(featureName) returning a MetricsHandle. runProdApp, the worker app and the dev server wire it from the observability meter, so provider plugins can emit their own metrics through the same pipeline.
migration: Code that builds SystemWireDeps itself adds metricsFor (createMetricsForFactory(meter)).
-->
