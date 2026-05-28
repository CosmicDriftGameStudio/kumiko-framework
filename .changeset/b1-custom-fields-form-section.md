---
"@cosmicdrift/kumiko-bundled-features": minor
---

Neues subpath-export `@cosmicdrift/kumiko-bundled-features/custom-fields/web` mit `CustomFieldsFormSection`-Component + `customFieldsClient()`-Factory. Apps mounten die Set-Value-UI via `createKumikoApp({ clientFeatures: [customFieldsClient()] })` und referenzieren sie im Screen-Schema als extension-section: `{ kind: "extension", title, component: { react: { __component: CUSTOM_FIELDS_FORM_EXTENSION_NAME } } }`. Plus `CustomFieldsHandlers` / `CustomFieldsQueries` constants und `CUSTOM_FIELDS_FORM_EXTENSION_NAME`-Konstante für den Schema-Lookup.

Werte werden heute beim Save sequentiell via `custom-fields:write:set-custom-field` dispatched; Pre-population existierender Werte ist ein Follow-up (braucht erweiterte `ExtensionSectionProps.values`).
