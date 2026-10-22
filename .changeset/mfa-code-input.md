---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-locale-de": minor
"@cosmicdrift/kumiko-locale-es": minor
"@cosmicdrift/kumiko-locale-fr": minor
"@cosmicdrift/kumiko-locale-it": minor
---

Six-cell one-time code input for the MFA screens: autofocus, auto-submit on the last digit in login and setup, and a recovery-code switch in verify, disable and regenerate.

<!-- kumiko-changes
feature: renderer
type: breaking
title: Input gets kind "code" and autoFocus on kind "text"
detail: Input has a new kind "code" (length, onComplete, autoFocus, autoComplete defaulting to one-time-code), a single real input shown as separate cells; onComplete fires once when input, paste or autofill reaches full length and the value holds digits only. kind "text" gains autoFocus.
migration: custom Input implementations (PrimitivesProvider override) with an exhaustive switch over props.kind need a case "code"; delegating to DefaultInput from @cosmicdrift/kumiko-renderer/web is enough
-->

<!-- kumiko-changes
feature: auth-mfa
type: improvement
title: Six-cell code input, autofocus, auto-submit and recovery switch
detail: The MFA login, setup, disable and regenerate screens use the six-cell code input with autofocus. Login and setup submit automatically on the sixth digit; disable and regenerate keep the explicit confirm button. Verify, disable and regenerate can switch to a recovery-code field. New keys auth.mfa.verify.useRecoveryCode, useAuthenticatorCode, recoveryCode and recoverySubtitle in all locale packages; auth.mfa.disable.code now names the authenticator code only.
-->
