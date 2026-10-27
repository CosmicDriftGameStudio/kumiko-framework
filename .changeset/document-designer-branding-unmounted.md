---
"@cosmicdrift/kumiko-document-designer": patch
---

The layout and PDF editors only ask for branding when managed-pages is mounted, so apps without it no longer log a 404 on every editor open.

<!-- kumiko-changes
feature: document-designer
type: fix
title: Editors skip the branding query without managed-pages
detail: The layout editor and the PDF template editor queried managed-pages:query:branding unconditionally. In an app without managed-pages that query has no handler and answered 404 each time an editor opened. They now check the app schema for managed-pages first and show branding as unavailable without asking.
-->
