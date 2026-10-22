---
"@cosmicdrift/kumiko-bundled-features": patch
---

The template `overview` search and the `title` sort now work on the title as the admin sees it. Before, a template seeded with `titleI18nKey` was searched and sorted by its raw key, so searching for "Tilgungsplan" found nothing. The query resolves the key with the locale of the request.

<!-- kumiko-changes
feature: template-resolver
type: fix
title: overview search and sort use the translated title
detail: The overview query translates a seeded titleI18nKey with the request locale before it filters by search and sorts by title. A search for the visible title now matches, and the raw key is still searchable.
-->
