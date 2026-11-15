---
"@cosmicdrift/kumiko-framework": patch
---

A `projectionDetail` step or banner navigate action with `params.map` now adds the mapped fields to its target form's URL prefill fields, as header actions already did. Before, the target form dropped those params and reported an invalid value.

<!-- kumiko-changes
feature: framework
type: fix
title: Step and banner actions prefill their target form
detail: Navigate actions under `steps.actions` and `banner.actions` of a projectionDetail screen now seed the target form's URL prefill fields from `params.map`, like the screen's own actions. A next-step button that passes a field other than the id fills the form instead of failing validation.
-->
