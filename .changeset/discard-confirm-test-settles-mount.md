---
"@cosmicdrift/kumiko-renderer": patch
---

The entityEdit discard-confirm test waits for the form's mount effects before it types and clicks

<!-- kumiko-changes
feature: renderer
type: fix
title: The entityEdit discard-confirm test waits for the form's mount effects before it types and clicks
detail: The test rendered outside act and only waited for the input to appear. Under CPU load the form's mount effects (store subscription, dirty reporting) ran after the click, so the header action still had no discard confirm and the test failed. The render now runs inside act, so the detail query, the commit and the effects settle first. Test-only change, no runtime behavior changes.
-->
