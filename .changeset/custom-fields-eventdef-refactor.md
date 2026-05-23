---
"@cosmicdrift/kumiko-bundled-features": patch
---

custom-fields: typed `eventDef.name` pattern statt Template-Literal-Konstruktion.

`createCustomFieldsFeature()` returnt jetzt typed `exports` (`setEvent`, `clearedEvent`, `fieldDefinitionDeletedEvent`). Handler + `wireCustomFieldsFor` nutzen `customFieldsFeature.exports.<event>.name` als compile-time literal-typed qualified-string — keine hand-gebauten `${FEATURE}:event:${SHORT}`-Strings mehr.

Rationale: T1 hat den toKebab-collapse-Bug aufgedeckt (Dots in short-names kollabieren zu Dashes → Registry-Mismatch bei hand-gebauten Strings). Mit dem refactor wird die Drift compile-time-strukturell unmöglich (siehe Memory feedback_event_def_exports_pattern).

Kein API-Change für consumers: `createCustomFieldsFeature()` bleibt unverändert; zusätzlicher named export `customFieldsFeature` (Singleton) ist additiv.
