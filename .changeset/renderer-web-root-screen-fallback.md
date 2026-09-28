---
"@cosmicdrift/kumiko-renderer-web": patch
---

Fix root-screen resolution so a bookmarked screen removed by role projection falls back to a reachable landing screen instead of rendering "Screen not found".

<!-- kumiko-changes
feature: renderer-web
type: fix
title: An explicit screenQn missing from the role-projected schema falls back to the first reachable screen
detail: |
  createKumikoApp's root route used an explicit screenQn unchecked; when the server's role
  projection removed that screen for the caller, /a showed "Screen not found". It now lands
  on the first reachable screen. A visible explicit screen and unprojected schemas are unchanged.
-->
