---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

A locked screen's fallback page gets the fallback's title in the header

<!-- kumiko-changes
feature: renderer
type: fix
title: A screen that falls back via visibleWhen shows the fallback's title
detail: When visibleWhen locks a screen and its fallback renders instead, the header no longer stays empty. It shows the title of the fallback screen (resolved like any other screen title, from its nav label), never the locked screen's. A fallback without a title still leaves the header empty. PageHeader takes a new breadcrumbScreenId prop for this.
-->
