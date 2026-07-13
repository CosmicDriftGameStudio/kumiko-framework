---
"@cosmicdrift/kumiko-bundled-features": minor
---

custom-fields: PII-Support entfernt (#972) — custom fields sind für
zusätzliche Business-Infos, nicht für personenbezogene Daten. BREAKING:
`serializedField.sensitive` wird beim Anlegen/Update rejected, gespeicherte
Definitionen mit dem Key werfen beim Parsen (zero-legacy, Feld neu anlegen).
Der Self-Projection-Sonderweg und der user-data-rights-Forget-Strip entfallen;
jeder `customField.set` trägt seinen Wert im Event — custom fields sind damit
vollständig rebuild-safe. PII gehört in Schema-Entity-Felder mit
pii/userOwned/tenantOwned-Annotation.
