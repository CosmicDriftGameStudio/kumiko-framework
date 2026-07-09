---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

Dashboard-`stat`-Panel: optionales `deltaField`/`deltaDirectionField`/`deltaToneField` — rendert einen Delta-Chip (z.B. "↓ 23 %") neben dem Label, wenn der Query-Handler beide Pflichtfelder (Wert + Richtung) liefert. Zusätzlich `icon`/`accentColor`: statische (nicht query-getriebene) Panel-Eigenschaften — `icon` löst über dieselbe `extensionSectionComponents`-Registry auf wie `custom`-Panels, `accentColor` ist ein roher CSS-Farbwert-Passthrough. Alle vier Felder rückwärtskompatibel, ohne sie ändert sich nichts.
