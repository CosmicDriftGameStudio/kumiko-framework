---
"@cosmicdrift/kumiko-framework": patch
---

Error docsUrl falls back to the framework page of the error code for uncovered app reasons

<!-- kumiko-changes
feature: framework
type: improvement
title: Error docsUrl falls back to the framework page of the error code for uncovered app reasons
detail: An error whose details.reason is an app reason not covered by errorDocs, such as the not_found reason of every NotFoundError, now carries docsUrl pointing at the framework page of its error code (for example /errors/not_found) instead of no docsUrl. Reasons covered by errorDocs keep the app link; framework reasons are unchanged.
-->
