---
"@cosmicdrift/kumiko-bundled-features": patch
---

The tag manager counts tag usage on the server and the tag catalog loads up to 200 tags.

<!-- kumiko-changes
feature: tags
type: fix
title: Tag usage counts and catalog no longer stop at 50
detail: The tag manager counted usage in the browser over the first 50 assignments, so counts were wrong from the 51st assignment on, and every tag catalog (manager, filter, column, section) showed at most 50 tags. Usage now comes from a grouped count over all assignments the user can see, and the catalogs load up to 200 tags.
-->
