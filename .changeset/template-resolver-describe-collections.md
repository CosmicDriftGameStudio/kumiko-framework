---
"@cosmicdrift/kumiko-framework": patch
---

template-resolver: Feature-Beschreibung deckt jetzt Content-Collections und kind `text-block` ab

Die Beschreibung nannte nur den Mail-Template-Fallback — entsprechend zeigte auch
die generierte Referenzseite auf docs.kumiko.rocks nichts von Content-Collections,
obwohl `text-content` gelöscht ist und Collections seit #1769 am Mount deklariert
werden. Dazu die verbliebenen `text-content`-Verweise in den Recipes, im
Feature-Kommentar und in `docs/reference/rbac-tenant-isolation.md` gezogen.

Kein Verhaltensänderung — Beschreibungstexte und Kommentare.
