---
"@cosmicdrift/kumiko-framework": minor
---

entityList: `rowActions` vom Typ `navigate` können mit `rowClick: true` als Ziel des Row-Body-Klicks markiert werden — ein Klick auf die Zeile (nicht nur das „…"-Aktionsmenü) löst dann diese Navigation aus.

Vorher navigierte der Row-Body-Klick ausschließlich zu `entityEdit`-Screens (`create-app` `effectiveOnRowClick`). Deklarative Listen, deren Editor ein `custom`-Screen ist, hatten dadurch einen toten Row-Klick, obwohl sie eine `navigate`-`rowAction` deklarierten. Opt-in — bestehende Listen bleiben unverändert. Höchstens eine `rowClick`-Action pro Liste (Boot-Validator). Der navigate-Dispatch ist zwischen Aktionsmenü und Row-Klick geteilt, damit beide Pfade nicht auseinanderdriften.
