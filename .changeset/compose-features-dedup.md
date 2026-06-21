---
"@cosmicdrift/kumiko-dev-server": patch
---

`composeFeatures({ includeBundled: true })` now de-duplicates app-features
whose name collides with one of the auto-mounted bundled foundation
features (`config`, `user`, `tenant`, `auth-email-password`).

Hit while recording the Phase 3 hero demo: the create-kumiko-app picker
hands back `createAuthEmailPasswordFeature()` (it's `recommended: true`),
runDevApp adds its own bundled copy via `includeBundled: true`, and
createRegistry then crashes with `Duplicate feature: "auth-email-password"`
— every freshly-scaffolded app was DOA on `bun dev`.

The bundled instance wins (it carries the `authOptions` wiring for
passwordReset / emailVerification / signup / invite); the app-side copy
is dropped with a `console.warn` so the user can remove the line from
`run-config.ts` to silence it.
