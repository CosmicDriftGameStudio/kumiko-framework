---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-types": patch
---

Template variable examples can be translated

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: Text examples of template variables follow the template's language
detail: The `example` of a text or richText templateVariable is now read like `label`: an i18n key resolves to the translation of the edited template's locale, plain text stays as it is. Preview, the sample values bar and send-test therefore show German examples for a German template. Example values of other types (link, number, enum-like text values) stay as declared; put the explanation of such a value into the variable's label. Apps: register `templateVariable.text({ example: "<app>:mail.example.x" })` and add the key with de, en and es via `r.translations`.
-->
