---
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

`seeds.bootstrapAdminFromEnv` takes `sendSetPasswordMail: true`: the owner created in that boot gets one "set your password" mail through the new system-only `auth-email-password:write:request-initial-password` handler (link valid 72 hours, own mail type `initial-password`, same token as the reset flow), so the owner does not have to go through "Forgot password?".

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: Bootstrap owner gets a set-password mail on first boot
detail: Set `sendSetPasswordMail: true` in `seeds.bootstrapAdminFromEnv`. Only the boot that creates the account sends the mail, through the new system-only `request-initial-password` handler (72 h link, own mail text). Without the password-reset flow (`mail` and `auth.mail`) nothing is sent and a send failure never aborts the boot.
-->
