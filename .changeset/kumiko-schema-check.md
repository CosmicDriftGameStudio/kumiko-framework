---
"@cosmicdrift/kumiko-dev-server": minor
"@cosmicdrift/kumiko-bundled-features": patch
---

`kumiko-schema-check` CLI — Empfehlung 3 aus Sprint-9.8-Retro
(`luminous-watching-moler.md`). Diff't APP_FEATURES (runtime, aus
`src/run-config.ts`) gegen FEATURE_IMPORT_REGISTRY (statisch, aus
`drizzle/generate.ts`). Fängt Studio's 9.8-Drama: registry 18 features
hinter APP_FEATURES → migrations fehlten für mounted features.

Usage (im app-workspace):
```sh
bunx kumiko-schema-check
# or with custom paths:
bunx kumiko-schema-check --run-config src/run-config.ts --generate drizzle/generate.ts
```

Plus: 5 bundled-features hatten camelCase feature-names statt kebab-case
(Memory `feedback_kebab_aggregates`) — aufgedeckt durch den schema-check
gegen use-all-bundled. Fix: `channelEmail` → `channel-email`,
`channelInApp` → `channel-in-app`, `channelPush` → `channel-push`,
`rateLimiting` → `rate-limiting`, `rendererSimple` → `renderer-simple`.

Plus `CHANNEL_IN_APP_FEATURE` und `RATE_LIMITING_FEATURE` Konstanten
angepasst (waren intern auf camelCase, jetzt kebab-case).
