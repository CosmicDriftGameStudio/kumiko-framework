---
"@cosmicdrift/kumiko-framework": patch
---

Extra routes outside /api get the request body cap for every entry

<!-- kumiko-changes
feature: framework
type: fix
title: Extra routes outside /api get the request body cap for every entry
detail: extraRoutes with entry anonymous or user outside /api now run behind the maxRequestBytes body limit like signature routes already did, so an unauthenticated caller can no longer stream an oversized body into a public form or callback route.
-->
