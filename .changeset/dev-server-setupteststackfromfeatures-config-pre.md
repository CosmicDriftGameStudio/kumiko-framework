---
"@cosmicdrift/kumiko-dev-server": patch
---

setupTestStackFromFeatures' config preset now also derives _configAccessorFactory

buildHandlerContext derives ctx.config from _configAccessorFactory, not configResolver directly, so a write handler under presets: ["config"] saw ctx.config as undefined even with a configResolver present. mergeExtraContext now also runs addConfigAccessorFactory (the same helper runProdApp/runDevApp use), keeping a base-supplied configResolver winning over the preset default. Closes #3313.

<!-- kumiko-changes
feature: dev-server
type: fix
title: setupTestStackFromFeatures' config preset now also derives _configAccessorFactory
-->
