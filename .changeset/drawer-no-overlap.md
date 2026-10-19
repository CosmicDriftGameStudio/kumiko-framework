---
"@cosmicdrift/kumiko-renderer": patch
---

Non-modal drawers narrow the content instead of covering it

<!-- kumiko-changes
feature: renderer
type: fix
title: Non-modal drawers narrow the content instead of covering it
detail: A Drawer with modal={false} on a wide viewport now publishes the width it occupies as --kumiko-drawer-inset-right or --kumiko-drawer-inset-left on the document root, and the shell content area (main next to the sidebar) takes it as inline padding, so error banners, right columns and the pinned form footer end beside the drawer. Modal drawers and narrow viewports keep overlaying. Two non-modal drawers open on the same side overwrite each other's value.
-->
