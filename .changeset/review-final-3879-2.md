---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

Selector fields in the generated provider forms now carry the owner feature in their field id, so two selector owners that both name their key `provider` no longer overwrite each other's empty-option label. The mail selector field is now `mail-foundation-provider` and its option labels live under `config:entity:__config-edit__:field:mail-foundation-provider:option:<value>`; the locale catalogs follow.

<!-- kumiko-changes
feature: framework
type: fix
title: provider selector option labels are unique per owner
detail: The selector field id of a provider form is qualified with its owner feature. An app that overrides the old key config:entity:__config-edit__:field:provider:option:<value> must move that override to the qualified field id.
-->
