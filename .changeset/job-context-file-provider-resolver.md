---
"@cosmicdrift/kumiko-framework": patch
---

Event- und cron-getriggerte Jobs bekommen den File-Provider-Resolver. Der
Job-Runner wurde vor `buildServer` gebaut und hatte damit den Context ohne
`_fileProviderResolver` — ein Job, der `ctx.files` liest, starb im Worker,
während derselbe Code auf dem Request-Pfad lief (fw#1807). Betrifft Worker-,
API- und All-in-One-Entrypoint sowie den Dev-Server.
