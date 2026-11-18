---
"@cosmicdrift/kumiko-bundled-features": minor
---

The default GDPR mails always name the app and, when sent from a request, use the request language for users without a stored locale.

<!-- kumiko-changes
feature: user-data-rights
type: breaking
title: GDPR default mails need an app name and follow the request language
detail: `GdprMailDefaults.appName` is now required, and the new boot rule `user-data-rights/mail-app-name-missing` fails boot when an email delivery channel or a `mail-transport-*` is mounted, `mailDefaults` is unset, and at least one default mail can go out (a `send*Email` callback is unset or the anonymous deletion flow is on). Before, these mails went out as "Account — …". The deletion-requested and deletion-verification mails, which are sent from a request, now pick the locale as user locale, then the request locale (X-Locale / Accept-Language), then `mailDefaults.locale`, then the boot default, the same way the auth mails do. A request locale without mail translations (e.g. `pl`) is skipped, so a German app still sends German mail instead of the English fallback; this applies to the auth mails (signup, token request, invite) too. Mails sent from jobs (export ready/failed, deletion executed) keep user locale, then `mailDefaults.locale`, then en. `resolveHandlerMailLocale` moved from auth-email-password into the shared helpers.
migration: Pass the app name, e.g. `createUserDataRightsFeature({ mailDefaults: { appName: "Acme" } })`. A multilingual app sets only `appName` and leaves `locale` unset, so the request language applies. Apps that replace every `send*Email` callback and do not use the anonymous deletion flow need no change.
affects: user-data-rights, GdprMailDefaults, mailDefaults, request-deletion, request-deletion-by-email, confirm-deletion-by-token
-->
