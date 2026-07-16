---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer-web": patch
---

Nav-/Screen-Labels rendern nicht mehr als roher i18n-Key, wenn ein Feature `r.translations({ keys })`
verwendet, aber keine App-seitige `web/i18n.ts`-Duplikation mitbringt (z.B. `cap-counter`, `admin-shell`,
`jobs`, `audit`). `buildAppSchema` projiziert `feature.translations` jetzt verbatim in `FeatureSchema`,
`createKumikoApp` pivotiert dieses Bundle client-seitig und reiht es zwischen `clientFeatures.translations`
(App-Override gewinnt weiterhin) und `kumikoDefaultTranslations` ein.

Beide Pakete müssen zusammen aktualisiert werden — die Server-Projektion allein liefert kein Bundle,
und ohne die neue `FeatureSchema.translations`-Projektion hat der Renderer nichts zu konsumieren.

`createPublicSurface` (schema-loser Mount für anonyme Seiten) bekommt nie ein `AppSchema` und ist von
diesem Fix nicht betroffen — anonyme Screens brauchen weiterhin explizite `clientFeatures.translations`.
