---
"@cosmicdrift/kumiko-renderer": patch
---

A projectionDetail metric is only clickable when its navigate target is reachable

`MetricNavigate` declares no access rule of its own, so a metric could jump to a screen the current user is not allowed to open — the destination rendered its access-denied banner, or the target's query rejected the request server-side, after the user had already clicked. The metric now derives its gate from the destination: `navigate.screen` is resolved by short id, `navigate.entity` through the screen declaring `detailFor`, and the screen's own `access` decides whether the metric renders clickable at all. No second copy of the rule on the metric, so it cannot drift from the screen's. A `navigate` with only `tab` set stays on the record and is unaffected.

Two consequences worth knowing. A navigate target that resolves to no registered screen is treated as denied — the boot-validator does not check metric navigate targets, so a typo'd target used to render a clickable metric that went nowhere and now renders a plain one. And the gate needs the app-wide screen registry `createKumikoApp` provides; a `KumikoScreen` rendered outside it sees no registry and every metric stays clickable, exactly as before.

<!-- kumiko-changes
feature: renderer
type: fix
title: A projectionDetail metric is only clickable when its navigate target is reachable
-->
