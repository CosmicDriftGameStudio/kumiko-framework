---
"@cosmicdrift/kumiko-dev-server": minor
---

`scaffoldAppFeature` + `kumiko add feature <name>` — DX-2 aus DX-Roadmap.
Scaffolded ein neues Feature in `src/features/<name>/` einer bereits via
`kumiko new app` scaffolded App + **auto-mountet** es in `src/run-config.ts`
via ts-morph (import + `APP_FEATURES`-array-entry, idempotent).

User-Promise "defineFeature → nichts woanders eintragen" erfüllt für die
run-config-Seite. FEATURE_IMPORT_REGISTRY in drizzle/generate.ts ist
DX-4's Refactor — bei DX-1+DX-2-App noch nicht vorhanden.

Usage (in einer DX-1-gescaffoldeten App):
```sh
bunx kumiko add feature product-catalog
# → src/features/product-catalog/{feature.ts,index.ts}
# → src/run-config.ts auto-edited: import + APP_FEATURES-entry
```
