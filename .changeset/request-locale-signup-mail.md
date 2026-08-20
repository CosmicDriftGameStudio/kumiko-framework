---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-dispatcher-live": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-server-runtime": minor
---

The browser's active UI language now reaches the server. `createLiveDispatcher` reads `document.documentElement.lang` and sends it as an `X-Locale` header on every request; `createKumikoApp`/`createPublicSurface` keep that attribute in sync with the app's `LocaleResolver` via a new `DocumentLangSync` component, so this works in every app with zero app-side wiring.

The server resolves the header (falling back to `Accept-Language`, then the app's boot-configured default locale, then `"en"`) into a new, always-present `ctx.locale` on `HandlerContext` — the same Request → Boot-Default precedence `ctx.tz` already uses.

Every magic-link mail in the auth-email-password feature (signup, password-reset, email-verification, invite, account-unlock) now renders in the requester's active locale instead of a hardcoded boot-time default, and each flow's `appUrl` can now be a `(locale: string) => string` function so apps with language-prefixed paths can point the link at the right locale.
