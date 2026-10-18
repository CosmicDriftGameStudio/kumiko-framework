---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-document-designer": minor
"@cosmicdrift/kumiko-renderer": minor
---

Template variable labels can be i18n keys

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: templateVariable label accepts an i18n key; the designer shows the translation instead of the raw name
detail: A label given as i18n key (templateVariable.text({ label: "billing:mail.variable.invoiceNumber" }) plus r.translations in each locale) is translated in the designer's variable rail, in the chips on the paper, in the steps and repeat block heads, in the placeholder, button, repeat and steps pickers of the editor toolbar and in the missing-variables footer; the raw variable name stays visible as tooltip. Plain-text labels keep working, a key without translation falls back to the key text. The server preview (sampleValuesFor, now with an optional labelText translator) names sample values by the translated label in the draft's locale. variableLabelMap in document-designer now takes the translator as first argument. VariableChips in the renderer takes optional labels.
-->
