---
"@cosmicdrift/kumiko-bundled-features": patch
---

isSafeReturnPath has its own light subpath, so pages without the Kumiko runtime can validate return paths.

<!-- kumiko-changes
feature: auth-email-password
type: improvement
title: isSafeReturnPath has its own light subpath
detail: Importing @cosmicdrift/kumiko-bundled-features/auth-email-password/return-path gives isSafeReturnPath, readReturnToFromSearch, RETURN_TO_QUERY_PARAM and MAX_RETURN_PATH_LENGTH without loading the web barrel, for example in Astro pages that run without the Kumiko runtime.
-->
