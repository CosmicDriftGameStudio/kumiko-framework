---
"@cosmicdrift/kumiko-dev-server": minor
---

`KUMIKO_DRY_RUN_ENV=boot` mode for runProdApp — runs env-validation +
composeFeatures + validateBoot + createRegistry without DB/Redis
connect, exits with status 0 on success. Used by the
`samples/apps/use-all-bundled` smoke-app (Sprint 9.8 Phase C / Empfehlung
1 / canonical bug-catcher) and downstream by enterprise's
`use-all-features` mirror. Render-modes (human|json|pulumi|k8s|1)
behavior unchanged.
