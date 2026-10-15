---
"@cosmicdrift/kumiko-bundled-features": minor
---

Auth mails are stored templates rendered by renderer-mail-html

<!-- kumiko-changes
feature: auth-email-password
type: breaking
title: Auth mails are notifications with seeded templates, render*Email is gone
detail: password-reset, account-unlock, email-verification, signup-activation and invite are declared as r.notification with a localized template and variables, seeded as system templates at boot and rendered by renderer-mail-html, so a tenant can override the text in the template editor. A locale without its own subject key falls back to en, because the renderer has no locale fallback. AuthMailNotificationTypes is exported for the qualified names.
migration: |
  The notification types are now `auth-email-password:notify:<name>` (before: the plain names). Update delivery preferences, preference rows and tests that reference the old names. renderResetPasswordEmail, renderUnlockAccountEmail, renderVerifyEmail, renderActivationEmail, renderInviteEmail, AuthMailSection, RenderTokenContentArgs and RenderInviteEmailArgs are removed; AuthMailContent stays. An app that mounts auth-email-password now needs template-resolver, renderer-foundation and @cosmicdrift/kumiko-renderer-mail-html (composeRendererStack() from dev-server mounts all of them; with includeBundled, composeFeatures adds whichever is missing). Boot fails with a clear error otherwise, and apps without the template tables need a schema migration (`kumiko schema generate`). kumiko-schema-check counts the three as implicit features of every HAS_AUTH app, so its check fails until that migration exists. Tests that read the token from a mail use the text part (`mail.text`); the html part encodes `=` as `&#x3D;`.
-->
