---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Set-Value-UI: gespeicherte customField-Werte beim Edit anzeigen (nicht write-only)

Die `CustomFieldsFormSection` lud nur die Field-Definitionen, nie die
gespeicherten Werte der Entity — die Inputs starteten beim Edit immer leer.
Set-Value war damit „write-only": man konnte Werte setzen, sah den Bestand
aber nie (Read-Back nach Reload war leer).

Fix: `ExtensionSectionProps` bekommt `initialValues`; `EntityEditUpdateForm`
reicht `record.customFields` (aus der detail-row) über `RenderEdit` an die
Section durch. Die Section füllt die Inputs daraus, `pending` trackt nur
Änderungen (Save bleibt bis zur ersten Eingabe disabled, nur geänderte
Felder werden geschrieben). Folgt auf den create-mode-Fix (0.34.1).
