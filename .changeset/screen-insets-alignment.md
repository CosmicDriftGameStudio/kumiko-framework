---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

Screen layouts line up across screen types. Forms, lists and dashboards share one screen inset (`px-4 md:px-10`), stacked related lists no longer pad themselves inside their section, the reference create dialog renders its form bare under the modal title, secretMint reveal and done phases use the form screen layout (new `CardOptions.screenBody`), and a projectionDetail with a header card renders as a screen form instead of a card form.

A projectionDetail with a header card and without `layout.width` now uses the screen form column width (640px), the same as the edit screen of that record. Set `layout.width` on the detail screen to keep it wider.

<!-- kumiko-changes
feature: renderer-web
type: improvement
title: Shared screen inset and aligned layouts for lists, forms, dialogs and secret mint
-->
