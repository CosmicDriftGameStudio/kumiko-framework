---
"@cosmicdrift/kumiko-bundled-features": patch
---

Template, layout and variant resolution each read the database once instead of walking the fallback chain query by query.

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: Template resolution in one query
detail: Every mail and PDF render resolved its template with up to four queries along the tenant/system and locale/fallback chain plus one more for the collection shadow check, layouts with two and variants with one per locale. Each now reads all candidate rows in one query and picks in the same order as before; the company placeholders of the empty-data check are read in parallel.
-->
