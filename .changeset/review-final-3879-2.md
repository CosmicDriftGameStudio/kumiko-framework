---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
"@cosmicdrift/kumiko-locale-fr": minor
"@cosmicdrift/kumiko-locale-it": minor
---

Selector fields in the generated provider forms now carry the owner feature in their field id, so two selector owners that both name their key `provider` no longer overwrite each other's empty-option label. The mail selector field is now `mail-foundation-provider` and its option labels live under `config:entity:__config-edit__:field:mail-foundation-provider:option:<value>`; the locale catalogs follow.

<!-- kumiko-changes
feature: framework
type: breaking
title: provider selector option labels are unique per owner
detail: The selector field id of a provider form is qualified with its owner feature, so the translation keys of its option labels change.
migration: move app translation overrides from config:entity:__config-edit__:field:provider:option:<value> to the owner-qualified field id, field:mail-foundation-provider:option:<value> or field:file-foundation-provider:option:<value>
-->
