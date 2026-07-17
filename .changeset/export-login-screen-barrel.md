---
"@cosmicdrift/kumiko-bundled-features": patch
---

Export `LoginScreen`/`LoginScreenProps`/`AuthLegalLink` from
`@cosmicdrift/kumiko-bundled-features/auth-email-password/web`. Every other
auth screen (ForgotPasswordScreen, SignupScreen, ResetPasswordScreen, …) was
already exported from the barrel with its props type; `LoginScreen` was
missed. `makeAuthGate`'s second parameter is typed `LoginScreenProps`, so
consumers passing a typed `loginScreenProps` override (e.g.
`@cosmicdriftgamestudio/kumiko-designer`) couldn't import the type at all.
