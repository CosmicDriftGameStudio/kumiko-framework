---
"@cosmicdrift/kumiko-framework": minor
---

requiredKeysFromScreen reads section.groups — group field labels and group titles are i18n-required

`requiredKeysFromScreen` (packages/framework/src/i18n/required-surface-keys.ts) read only `section.fields` in all six `EditFieldsSection` branches (`entityEdit`, `actionForm`, `secretMint` mint + confirm layout, `configEdit`, `projectionDetail`), so a field declared through `section.groups` never reached the required-key set and `groups[].title` was never required at all — while `computeEditViewModel` translates a group title exactly like a section title. `validateI18nSurfaceKeys` therefore let a screen boot with untranslated group field labels and group titles, the one error class that guard exists for.

The new `sectionFieldSpecs` in packages/framework/src/engine/screen-helpers.ts returns the union of `section.fields` and `section.groups[].fields` (a union, unlike the boot-validator's either-or `flattenFieldsOrGroups`, which runs after the fields-XOR-groups check) and is used at all six branches; each branch now also pushes every `groups[].title` alongside `section.title`, honoring the same `treatDotFormAsKey` option. The `writeForm` branch in `projectionDetail` is unchanged — `EditWriteFormSection` has no `groups`.

<!-- kumiko-changes
feature: framework
type: breaking
title: requiredKeysFromScreen reads section.groups — group field labels and group titles are i18n-required
migration: |
  The i18n boot guard now demands translations it silently skipped before. An app whose entityEdit/actionForm/secretMint/configEdit/projectionDetail screens declare fields through `layout.sections[].groups` can newly fail boot with `required translation key missing: "<feature>:entity:<entity>:field:<name>"`. Add the missing field-label keys (or a `fieldLabels` override, where that screen type supports one) for every field declared under `groups[].fields`. Colon-form `groups[].title` values are now required too — add the key, or keep the title as literal display text (no colon, no `i18nKey()`) if it is not meant to be translated. Dot-form group titles behave exactly like dot-form section titles: only required when the caller passes `treatDotFormAsKey`.
-->
