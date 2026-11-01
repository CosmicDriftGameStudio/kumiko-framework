---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

SignupScreen reads the signup registration status and shows a closed state when self-registration is off.

<!-- kumiko-changes
feature: auth-email-password
type: improvement
title: SignupScreen shows a closed state while self-registration is off
detail: With a mounted dispatcher the screen asks `auth-email-password:query:signup-registration-status`. While `enabled` is false it renders the notice `auth.signup.closed` (de: "Die Registrierung ist derzeit nur mit Einladung möglich.") plus the login link instead of the form, and sends nothing. A failed status query reads as open. The status query needs a mounted `DispatcherProvider`; in standalone auth mounts without one the form always shows and the server still rejects `signup-request`. New key `auth.signup.closed` in en, de, es, fr and it.
-->
