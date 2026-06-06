---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-dev-server": minor
"@cosmicdrift/kumiko-bundled-features": patch
---

extraRoutes-deps liefern jetzt `registry` + `dispatchSystemWrite` (runProdApp + createKumikoServer/runDevApp) — das Wiring, das `createSubscriptionWebhookHandler` für Provider-Webhook-Routen braucht. Dazu: `KumikoServer`/`ApiEntrypoint`/`TestStack` exponieren den Command-Dispatcher, `createSystemUser` nimmt optionale `extraRoles` (kein Access-Bypass für die system-Rolle — Ziel-Handler gaten auf explizite Rollen wie SystemAdmin).
