---
"@cosmicdrift/kumiko-bundled-features": minor
---

`auth-email-password/web` no longer exports `LoginScreen`/`LoginScreenProps`
directly — use the new `createLoginRoute({ loginScreenProps, mfaVerifyScreen,
onAuthenticated })` instead. `makeAuthGate`/`makeSessionAuthGate` are
unaffected (they already build on the same logic internally now).

Why: a raw `<LoginScreen />` render has no MFA-challenge handling unless the
caller remembers to hand-wire `onMfaChallenge` + swap in a verify screen
itself — exactly how kumiko-framework#266's login-time MFA step went
missing in a real app's standalone apex/marketing login route (it renders
outside `emailPasswordClient`'s own gate, which already handled this
correctly). `createLoginRoute` is the one place this logic lives now, for
both the gated and standalone cases — there's no lower-level piece left to
misuse. The `apex-surface-auth` recipe is updated to match.
