---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-guards": patch
---

Remove unknown cast-boundary reasons and share propertyOf

<!-- kumiko-changes
feature: framework
type: improvement
title: Remove unknown cast-boundary reasons and share propertyOf
detail: Framework internals read untyped properties through the shared propertyOf from kumiko-types instead of private copies and casts. The as-casts guard knows four more boundary reasons (phantom-brand, third-party-type-gap, dom-event-target, feature-exports) and normalizes whitespace in cast targets so re-indenting a multi-line cast no longer counts as a regression. A stored inbound-mail cursor that is not a JSON object is now treated like a missing cursor.
-->
