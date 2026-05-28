---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer": minor
---

`EditSectionSpec` ist jetzt eine Discriminated Union mit `kind?: "fields"` (default, backwards-compat) und `kind: "extension"` (mountet eine feature-bereitgestellte Component). `EditSectionViewModel` parallel als Union (`kind` required). Neue exports: `EditFieldsSection`, `EditExtensionSection`, `EditFieldsSectionViewModel`, `EditExtensionSectionViewModel`, plus Type-Guard `isExtensionEditSection(section)`. Boot-Validator validiert den component-Marker für extension-sections im entityEdit-Block. Bestehende screens (kind weggelassen) rendern unverändert.
