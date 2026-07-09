---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

Dashboard-Screen-Typ: vier neue Panel-Kinds — `stat-group` (betitelte Sektion aus mehreren Stat-Panels), `feed` (nicht-tabellarische Kurzliste), `progress-list` (Label/Wert + Fortschrittsbalken) und `custom` (eingehängte App-Komponente über dieselbe extensionSectionComponents-Registry wie entityEdit-Sections und List-Header-Slots, bleibt an ihrer Array-Position). Plus ein screen-weiter `filter` (Combobox-Picker), dessen Wert in jede Panel-Query gemerged wird — nutzt den bestehenden `useQuery`-payloadKey-Refetch, kein neuer Mechanismus. `ExtensionSectionProps` bekommt ein neues optionales `filterParams`-Feld für den `custom`-Mount-Ort.
