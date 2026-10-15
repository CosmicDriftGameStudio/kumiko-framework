---
"@cosmicdrift/kumiko-renderer": patch
---

Optional number fields start empty instead of 0

A number field without default that is not required starts empty in entityEdit create and edit; an untouched one is neither created nor updated. Required numbers still start at 0. Apps that relied on an implicit 0 declare default: 0.

<!-- kumiko-changes
feature: renderer
type: fix
title: Optional number fields start empty instead of 0
-->
