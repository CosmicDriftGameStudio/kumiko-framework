---
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-bundled-features": minor
---

Theme-Persistenz, cancelTarget für actionForms, Login-Legal-Links

- Theme-Wahl wird in localStorage persistiert (`kumiko:theme`) und beim
  ersten Mount restored (`applyStoredThemeMode` + `THEME_STORAGE_KEY`
  exportiert) — vorher war der Dark/Light-Toggle nach jedem Reload weg.
  FOUC-Schutz: Inline-Script-Snippet siehe tokens.ts-Header.
- `ActionFormScreenDefinition.cancelTarget?: string | false`: entkoppelt
  den Abbrechen-Button vom Submit-`redirect`; `false` entfernt ihn
  (Single-Action-Screens wie „Test-Mail senden"). Boot-Validator prüft
  String-Targets wie `redirect`.
- `LoginScreen` bekommt `legalLinks` (Impressum/Datenschutz unterhalb
  der Card) — der Login ist oft die einzige öffentliche Seite einer
  Admin-Domain und braucht erreichbare Legal-Links (Impressumspflicht).
