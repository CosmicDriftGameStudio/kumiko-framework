---
"@cosmicdrift/kumiko-dev-server": patch
---

run-prod-app: static-fallback served index.html nur noch für GET/HEAD — non-GET ohne Hono-Match liefert den Hono-404 durch (vorher 200 index.html, wodurch z.B. falsch konfigurierte Webhook-Endpoints als delivered galten).
