---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-dev-server": minor
---

Bug-Bash-2 Wave F2: Renderer-Fixes + Auth-Vorarbeit

- Settings-Screens: "Vorgabe"-Block (Source-Badge + Cascade-Disclosure)
  erschien doppelt pro Feld — RenderEdit reichte denselben Callback als
  labelAppendix UND fieldAppendix durch. Jetzt zwei getrennte Callbacks.
- timestamp-Felder: neues TimestampInput konvertiert zwischen lokaler
  Wall-Clock (datetime-local) und UTC-Instant mit `Z` — Saves endeten
  vorher in 422 invalid_format. locatedTimestamps bleiben Wall-Clock
  (neues wallClock-Flag im EditFieldViewModel/FieldInputProps).
- Validierungsfehler: errors.validation.*-Keys (Zod-4-Codes +
  Framework-Codes) in den de/en-Default-Bundles, Field interpoliert
  issue.params ({minimum} etc.) — vorher rohe Keys in der UI.
- AuthRoutesConfig.cookieDomain: Domain-Attribut für beide Auth-Cookies
  (Cross-Subdomain-Login), Logout löscht Domain- und host-only-Variante.
  Pass-through via RunProdApp/RunDevApp-Auth-Options.
- HostDispatchFn bekommt `search` (Query-String) für verlustfreie
  Host-Redirects (additiv).
