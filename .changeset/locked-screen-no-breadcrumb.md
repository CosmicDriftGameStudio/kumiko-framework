---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

A locked screen's fallback shows no breadcrumb

When `visibleWhen` is unmet, the route still names the locked screen, so the shell header kept that screen's breadcrumb above the fallback or the unavailable notice. The gate now mounts `<PageHeader hideBreadcrumb />`, and the shell header drops the breadcrumb while it is mounted. Embedded screens (dashboard panels, drawers) are not affected.

<!-- kumiko-changes
feature: renderer
type: fix
title: The shell header drops the locked screen's breadcrumb while a visibleWhen fallback or notice is shown
-->
