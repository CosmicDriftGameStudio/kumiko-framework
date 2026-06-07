---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": minor
---

ConfigCascadeView übersetzt + scope-gefiltert

- Source-Badges und Cascade-Texte zeigten rohe i18n-Keys
  (`config.source.default` …) — die Keys existierten in keinem Bundle.
  Jetzt `kumiko.config.source.*` / `kumiko.config.cascade.*` mit de/en-
  Defaults in `kumikoDefaultTranslations`; `ConfigSourceBadge` nutzt
  dieselben Keys statt hartkodiertem Englisch.
- Nicht-System-Screens zeigen nur noch die eigene Cascade-Ebene plus
  EINE neutrale „Vorgabe"-Zeile (effektiver Wert) — System/App-Override/
  Computed sind Operator-Interna und für Tenant-/User-Scope unsichtbar.
  `screenScope="system"` behält die Vollsicht.
