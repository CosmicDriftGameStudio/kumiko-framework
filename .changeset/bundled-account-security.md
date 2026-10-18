---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
---

New bundled feature account-security

<!-- kumiko-changes
feature: account-security
type: improvement
title: createAccountSecurityFeature bundles the self-service screen for MFA and own sessions
detail: createAccountSecurityFeature({ nav?, access? }) registers account-security:screen:account-security, a dashboard that embeds the auth-mfa enable, regenerate and disable screens and the sessions list of the signed-in user. It owns no handlers and needs no composeAuthStack; mount it next to auth-mfa and sessions. Without nav the screen is dormant (no sidebar entry); nav takes { order?, parent? } with order 90 by default. access defaults to every signed-in user. Apps with a local copy of this screen replace it with the bundled feature.
-->
