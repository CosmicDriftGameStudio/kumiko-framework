---
"@cosmicdrift/kumiko-framework": minor
---

Update-Awareness (default an): Der Prod-Build (`buildProdBundle`) schreibt eine
selbsttragende Build-ID — ein Hash über die content-gehashten Asset-URLs — als
`dist/build-info.json` und bäckt sie als `window.__KUMIKO_BUILD__` in die
index.html. Jede renderer-web-App mountet einen `<UpdateChecker/>`, der beim
Tab-Fokus (`visibilitychange`/`focus`) `build-info.json` pollt und ein
Reload-Banner zeigt, sobald sich die ID ändert — ein offener Tab erfährt so von
einem neuen Deploy, ohne Hard-Reload und ohne Service-Worker.

`builtAt` (ISO-Zeitstempel) steht auf `window.__KUMIKO_BUILD__` als lesbare
Anzeige-Version bereit (ersetzt rohe git-shas). Quelle ist die statische
build-info.json, nicht `/api/version` (live unzuverlässig). Fail-safe: ohne
gebackene Build-ID (Dev, altes Bundle) oder bei Fetch-Fehler kein Banner.
