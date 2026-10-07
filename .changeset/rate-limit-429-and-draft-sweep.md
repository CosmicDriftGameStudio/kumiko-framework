---
"@cosmicdrift/kumiko-bundled-features": patch
---

Managed pages and sitemap answer 429 when rate limited, agent catalog checks the deny list, draft cleanup continues past skipped rows

A rate-limited managed-page request now answers 429 with `Retry-After` instead of 503 or an unbranded page, and `sitemap.xml` and `llms.txt` answer 429 instead of silently dropping the managed-page entries. `buildToolCatalog` throws when its manifest was built with `denyQns` that the catalog options lack. The form-draft cleanup no longer stops when a whole batch was re-saved by users in the meantime.

<!-- kumiko-changes
feature: managed-pages
type: fix
title: A rate-limited page request answers 429 with Retry-After instead of 503 or an unbranded page
-->

<!-- kumiko-changes
feature: seo
type: fix
title: sitemap.xml and llms.txt answer 429 when the managed-pages read is rate limited instead of omitting the pages
-->

<!-- kumiko-changes
feature: agent-tools
type: fix
title: buildToolCatalog throws when the manifest was built with denyQns the catalog options lack
migration: Pass the same denyQns list to buildAgentManifest and buildToolCatalog.
-->

<!-- kumiko-changes
feature: form-draft
type: fix
title: The stale-draft cleanup keeps sweeping when a whole batch was re-saved in the meantime
-->
