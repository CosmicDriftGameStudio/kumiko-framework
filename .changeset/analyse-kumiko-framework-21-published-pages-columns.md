---
"@cosmicdrift/kumiko-bundled-features": patch
---

`managed-pages:query:by-tenant-published` reads only the discovery columns, sorted and capped.

<!-- kumiko-changes
feature: managed-pages
type: improvement
title: Published page list no longer loads page bodies
detail: The query behind sitemap.xml and llms.txt loaded every published page with its full body. It now reads only slug, language, title and change time, sorted by slug and language and capped at 5,000 pages.
-->
