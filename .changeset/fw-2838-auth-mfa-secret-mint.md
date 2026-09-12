---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

fw#2838: `auth-mfa`'s TOTP enrollment is declarative — the last `type: "custom"` screen in the bundled features, and with it the second `app-feature-structure` lint-ignore, is gone. The enable flow is now one `secretMint` screen: mint (no input) → one-time reveal of the QR code, the manual base32 secret and the eight recovery codes → a confirm step that arms MFA with a code from the authenticator app. The recovery codes still exist only in `enable-start`'s success payload, are never persisted in the clear and no query re-serves them; the short-lived `setupToken` is threaded from the mint payload into the confirm payload through component state alone — it is deliberately not part of `reveal.fields`, so it never reaches the screen, the URL, a query cache or a persisted draft.

Three generic additions to the `secretMint` screen type carry it (none of them auth-mfa-specific, no feature flags):

1. `SecretMintConfirmStep` (`screen.confirm`) — a proof-of-receipt form rendered on the reveal card in place of the bare acknowledge button, for a mint whose effect is only armed once the user proves they received the secret. `carry` names mint success-payload fields that are merged into the confirm payload at submit time; they live in component state only and are never rendered or written into form values. The boot-validator rejects a confirm step with no fields, a `wizard`/`tabs` layout, `draft: true` (a persisted draft of a reveal-phase form is the exact leak fw#2548 closed) and a `carry` entry that collides with a confirm field name.
2. `SecretRevealField.display: "qr"` — renders the value as a scannable QR code. `renderer-web`'s `SecretReveal` primitive ships the implementation (new `qrcode` dependency); platforms without a QR-capable primitive fall back to the monospaced text.
3. A `secretMint` may declare `fields: {}` with `layout: { sections: [] }` when the mint takes no user input at all — the secret is server-generated and the mint step is just its submit button. `actionForm` still requires at least one field.

A `secretMint` without a `redirect` now shows a done banner (`kumiko.secretMint.done`, or `confirm.doneMessage`) after the reveal is confirmed, instead of falling back to the mint form where a stray click would mint the secret again.

`auth-mfa:write:enable-start` takes `accountLabel` as optional now and derives it from the caller's own email when omitted (there is no client component left that could pass the session email); its success payload additionally carries `totpSecret`, the base32 secret the otpauth URI already embeds, for the reveal's manual-entry display. Both are backward compatible. `auth-mfa:query:user-mfa:status` backs no declarative list and keeps its plain `{ enabled }` shape — no paged-envelope migration like `personal-access-tokens:query:mine` needed.

**BREAKING**

`@cosmicdrift/kumiko-bundled-features/auth-mfa/web` no longer exports `MfaEnableScreen` / `MfaEnableScreenProps`, and `authMfaClient()` no longer maps a component onto the `auth-mfa-enable` screen id. The subpath itself stays — the login-time `MfaVerifyScreen`, `MfaDisableDialog`, `MfaRegenerateRecoveryDialog` and `MfaSetupPreauthScreen` are unchanged, and `authMfaClient()` is still required for their translations. Migration: an app that embedded `<MfaEnableScreen embedded />` navigates to the `auth-mfa-enable` screen instead; the `onEnabled` callback has no successor — the screen ends on its own done banner, and a host screen that gated on it should re-read `auth-mfa:query:user-mfa:status` when the user navigates back. The `auth.mfa.enable.*` translation keys that only the deleted component used are gone from the client bundle's defaults; overrides for them can be dropped.
