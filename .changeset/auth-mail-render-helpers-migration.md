---
"@cosmicdrift/kumiko-bundled-features": patch
---

Migration recipe for apps that rendered auth mails with the render*Email helpers removed in 0.363.0

<!-- kumiko-changes
feature: auth-email-password
type: fix
title: How to send an auth mail after the render*Email helpers were removed in 0.363.0
detail: No runtime change. The 0.363.0 breaking entry lists renderActivationEmail, renderResetPasswordEmail, renderUnlockAccountEmail, renderVerifyEmail and renderInviteEmail as removed but does not say how app code that rendered one of these mails itself now sends it. This entry adds that recipe.
migration: |
  App code that rendered an auth mail itself and passed the result as `data`, for example `notify("auth-email-password:signup-activation", { route: { email }, data: renderActivationEmail({ url, expiresAt, locale, appName }), priority: "critical" })`, breaks twice since 0.363.0: the helper is gone and the notification type is now `auth-email-password:notify:signup-activation`. The stored template renders subject and body; the app only passes template variables.
  For a signup activation link, call `issueSignupActivation({ redis, notify: ctx.notify, email, appUrl, appName, locale, timeZone, tokenTtlMinutes, onTokenStored })` from `@cosmicdrift/kumiko-bundled-features/auth-email-password` (only redis, notify, email and appUrl are required). It drops any live signup token for the email, stores a new one under the keys signup-confirm reads and sends the mail. `appUrl` is the bare activation page; a function `(locale) => url` picks the page per locale.
  If the app stores the token itself and only needs the mail, call `ctx.notify(AuthMailNotificationTypes.signupActivation, { route: { email }, data: { appName, actionUrl, validFor, validUntil }, locale, priority: "critical" })`. `AuthMailNotificationTypes` comes from `@cosmicdrift/kumiko-bundled-features/auth-email-password`. All four variables are required strings: ctx.notify checks them against the declared template variables and throws an InternalError on a missing or invalid one, which fails the write. `actionUrl` is the page URL with `token=<encodeURIComponent(token)>` appended as a query parameter and must be an http, https or mailto URL. `validFor` and `validUntil` come from `tokenMailExpiry({ expiresAt, issuedAt, timeZone }, locale)` in `@cosmicdrift/kumiko-bundled-features/auth-email-password/email-templates`. Only send a `locale` that has a template for the type, because the renderer has no locale fallback and a locale without a template sends nothing: use `resolveMailLocale(locale)` when `hasMailTranslationKey(resolveMailLocale(locale), "auth.mail.activation.subject")` is true (both from `@cosmicdrift/kumiko-framework/i18n`), otherwise `"en"`. The other mails use the subject keys `auth.mail.reset.subject`, `auth.mail.unlock.subject`, `auth.mail.verify.subject` and `auth.mail.invite.subject`.
  The other auth mails work the same way with `AuthMailNotificationTypes.passwordReset`, `.accountUnlock`, `.emailVerification` and `.invite`; the invite mail also needs a `role` variable.
-->
