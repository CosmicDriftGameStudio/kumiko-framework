---
"@cosmicdrift/kumiko-testing": patch
---

captureScreenshot, runScreenshots and runMatrix settle after a reload or cross-document navigation

<!-- kumiko-changes
feature: testing
type: fix
title: captureScreenshot, runScreenshots and runMatrix settle after a reload or cross-document navigation
detail: |
  Chromium drops the old document's fetch/XHR requests on a reload, goto or
  location change without firing requestfinished or requestfailed. The
  in-flight tracker kept those requests forever, so a flow that reloaded
  while a data request was still open failed with "page never settled".
  The tracker now clears its in-flight set when the main frame commits a new
  document (a main-frame navigation request followed by framenavigated).
  A same-document navigation (pushState) still waits for its requests, and
  a navigation that never commits (204, download) keeps them too.
-->
