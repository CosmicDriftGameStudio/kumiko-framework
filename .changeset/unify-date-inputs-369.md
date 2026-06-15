---
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-framework": minor
---

Date/Calendar-Inputs vereinheitlicht (#369): `date` und `timestamp` teilen jetzt
eine gemeinsame, tippbare Eingabe mit Jahres-/Dekaden-Dropdown im Kalender. Datümer
sind überall direkt tippbar (locale-aware Parse), nicht mehr nur per Klick. Neu pro
Feld konfigurierbar: `min`/`max` (Picker-Range + Zod-Durchsetzung beim Write) und
`locale` (Anzeige-/Eingabe-Format) auf `date`/`timestamp`/`locatedTimestamp`-Feldern.
