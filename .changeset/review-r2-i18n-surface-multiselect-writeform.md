---
"@cosmicdrift/kumiko-framework": patch
---

The i18n key guard now requires translations for filterable `multiSelect` option labels and for the `description` of a `projectionDetail` writeForm section. Missing translations used to fall back silently; they now fail the guard.

<!-- kumiko-changes
feature: framework
type: breaking
title: i18n key guard covers multiSelect option labels and writeForm section descriptions
migration: |
  The i18n required-surface-keys check now requires translations for filterable `multiSelect` option labels and `projectionDetail` writeForm section descriptions; add the missing keys to your locale files.
-->
