---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
---

user-data-rights sends the verification mail of the anonymous account deletion itself, as a localized notification template.

<!-- kumiko-changes
feature: user-data-rights
type: breaking
title: The anonymous deletion verify mail comes from user-data-rights
detail: `request-deletion-by-email` now sends the verify link through `ctx.notify` as `user-data-rights:notify:deletion-verification` (route to the entered address, priority critical, after commit through the delivery queue), rendered from a seeded template in the user's locale with `mailDefaults`. The option `sendDeletionVerificationEmail` and the type `SendDeletionVerificationEmailFn` are removed. Setting `deletionTokenSecret` and `deletionVerifyUrl` now requires the `delivery` and `channel-email` features at boot. New translation keys `gdpr.mail.deletionVerification.*` in en, de, es, fr and it.
migration: Remove `sendDeletionVerificationEmail` from `createUserDataRightsFeature(...)` and delete the app's own verify mailer. Mount `createDeliveryFeature()` and `createChannelEmailFeature(...)` if the app sets `deletionTokenSecret` and `deletionVerifyUrl`. Custom wording or branding goes into a template override of `user-data-rights:notify:deletion-verification` or into `mailDefaults.appName`.
affects: sendDeletionVerificationEmail, SendDeletionVerificationEmailFn, deletionTokenSecret, deletionVerifyUrl
-->
