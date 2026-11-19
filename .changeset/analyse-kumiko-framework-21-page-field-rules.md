---
"@cosmicdrift/kumiko-bundled-features": patch
---

The managed-pages admin CRUD checks slug, language and OG image like `managed-pages:write:set`.

<!-- kumiko-changes
feature: managed-pages
type: fix
title: One validation for page slug, language and OG image
detail: Only `managed-pages:write:set` checked that a slug is kebab-case and a language is an ISO 639-1 code; the admin create and update handlers stored any text, so a page could get a slug its URL never resolves. Both paths now share one rule set, and `ogImage` must be empty or an https URL on both.
-->
