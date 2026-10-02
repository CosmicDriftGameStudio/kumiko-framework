---
"@cosmicdrift/kumiko-framework": patch
---

A qualified redirect target (`feature:screen:id`) is now resolved inside the named feature, so a same-id screen in the redirecting feature no longer swallows the created record id. An entityEdit update form only presence-checks required fields the user changed, so a legacy row with an empty, newly required field can still be saved. The secretMint confirm step always offers a cancel that restarts at the mint form when no redirect or cancelTarget is set.

<!-- kumiko-changes
feature: framework
type: fix
title: Qualified redirects resolve in their named feature, update forms skip untouched required fields, secretMint confirm can restart
-->
