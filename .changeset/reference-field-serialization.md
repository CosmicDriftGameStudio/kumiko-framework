---
"@cosmicdrift/kumiko-framework": patch
---

fix(schema): reference-Entity-Felder behalten entity/labelField/multiple in der Client-Schema-Serialisierung

`buildAppSchema.projectField()` whitelistete für `reference`-Felder nur
`type`/`required`/`sortable`/`filterable`/`default`/`options` — `entity`,
`labelField` und `multiple` fielen aus dem serialisierten `window.__KUMIKO_SCHEMA__`
heraus. Dadurch bekam der Client-Renderer ein reference-Feld ohne Target-Entity:
der `ReferenceInput` baute die Options-Query als `<feature>:query::list` (leeres
`refEntity`) → 404 → das Dropdown blieb leer, obwohl die referenzierte Entity Rows
hat. Betraf jedes reference-Feld in einem `entityEdit`-Screen (actionForm-Fields
sind nicht betroffen — Screens werden verbatim serialisiert).
