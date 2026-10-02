---
"@cosmicdrift/kumiko-framework": patch
---

The i18n key guard now requires translations for filterable `multiSelect` option labels and for the `description` of a `projectionDetail` writeForm section. Missing translations used to fall back silently; they now fail the guard.

<!-- kumiko-changes
feature: framework
type: fix
title: i18n key guard covers multiSelect option labels and writeForm section descriptions
-->
