---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-dev-server": minor
---

auth-email-password: migrate the magic-link mail flows (password-reset, email-verification, signup) off app-supplied `send*Email` callbacks onto the `delivery` system (#562).

`ctx.notify` is now wired in production: `runProdApp` / `runDevApp` build a `DeliveryService` and bind it as the dispatcher's per-user `_notifyFactory` when the `delivery` feature is mounted (previously only tests wired it, so every production notification was silently dropped). The three flows' request handlers now render structured content and dispatch via `ctx.notify({ route: { email }, priority: "critical" })`; `delivery` becomes a hard boot-time requirement when any of them is mounted.

Breaking for app authors who wired these flows by hand:

- `PasswordResetConfig` / `EmailVerificationConfig` / `SignupConfig` (framework auth-routes) no longer take `sendResetEmail` / `appResetUrl` / `sendVerificationEmail` / `appVerifyUrl` / `sendActivationEmail` / `appActivationUrl` — they shrink to `{ requestHandler, confirmHandler }`.
- `PasswordResetOptions` / `EmailVerificationOptions` / `SignupOptions` (and the dev-server `*Setup` wrappers) now carry `appUrl` (+ optional `appName` / `locale`) instead of the callback; `signup` now requires `appUrl`.
- `createAuthMailerConfig` / `AuthMailerConfig` shrink to invite only.
- `renderActivationEmail` now returns structured `AuthMailContent` (was `RenderedEmail`); `RenderActivationEmailArgs` is removed (use `RenderTokenContentArgs`).

Mount `delivery()` + a mail channel + a transport instead of writing the reset/verify/signup mail callbacks. Tenant invite is unchanged (still callback-based).
