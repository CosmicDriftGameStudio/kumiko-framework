---
"@cosmicdrift/kumiko-framework": minor
---

Boot rejects a longText field with find "fuzzy" and a restricted access.read.

<!-- kumiko-changes
feature: search
type: breaking
title: Fuzzy-searchable longText fields cannot restrict access.read
detail: The search index is not filtered per role, so a fuzzy-searchable longText with a restricted access.read let roles that cannot read it guess its value from search matches. The boot rule entity/searchable-restricted-read now covers longText like text.
migration: Drop find "fuzzy" or the access.read restriction on the longText field the boot error names.
affects: fuzzy, searchable
-->
