---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
---

The boot validator and the renderer's list payload tests share one derivation of the optional list query keys.

<!-- kumiko-changes
feature: framework
type: fix
title: One shared derivation of the list query keys the summary-row check expects
detail: `listPayloadKeysSent` in `@cosmicdrift/kumiko-types/screen` turns a list screen's capabilities (searchable, filters, named filters, screen filter) into the optional query keys it sends. The boot validator's summary-row schema check uses it instead of a hand-written copy, and renderer tests run the real entityList and projectionList payload builders and compare their keys with it.
-->
