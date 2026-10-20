---
"@cosmicdrift/kumiko-renderer-mail-html": patch
---

Mail rendering passes the registry to createTemplateResolverApi so locked overrides are not served.

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: Mail rendering follows the template delivery policy
detail: Resolves templates through createTemplateResolverApi(db, registry); overrides of locked templates fall back to the system version.
-->
