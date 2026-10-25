---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

A list section with a description and only toolbar actions (for example a create button) shows both in one row: description left, actions right, wrapping below the text on narrow widths. Section headers wrap their actions the same way. The cap cards "view all" link uses the primary link style.

<!-- kumiko-changes
feature: data-table
type: fix
title: List descriptions sit beside the toolbar actions
detail: A description plus a toolbar with only end content (no search, no facets) renders as one row with the actions on the right, in embedded and full-height lists. Before, a full-height list put the description under the create button. With search or facets the layout is unchanged. Section header actions wrap below the title on narrow widths.
-->

<!-- kumiko-changes
feature: cap-overview
type: fix
title: Cap cards "view all" link uses the primary link style
detail: The link under the cap cards no longer renders in muted grey; it uses the default link variant like other text links.
-->
