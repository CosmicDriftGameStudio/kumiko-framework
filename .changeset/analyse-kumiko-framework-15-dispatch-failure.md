---
"@cosmicdrift/kumiko-bundled-features": patch
---

A failing job dispatch now closes the queued delivery attempt as failed.

<!-- kumiko-changes
feature: delivery
type: fix
title: Failed job dispatch no longer leaves a delivery attempt queued
detail: When handing a queued delivery to the job runner fails, notify() appends a `failed` event with `channel_error` to the same attempt and reports that delivery as failed. Before, the attempt stayed `queued` forever and a second failed attempt row appeared next to it.
-->
