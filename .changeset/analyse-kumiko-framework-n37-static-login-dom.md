---
"@cosmicdrift/kumiko-bundled-features": patch
---

Static sites bind the email/password login form with one call instead of their own DOM glue.

<!-- kumiko-changes
feature: auth-email-password
type: improvement
title: mountStaticLoginForm binds the static login to a data-attribute markup contract
detail: `@cosmicdrift/kumiko-bundled-features/auth-email-password/static-login-dom` exports `mountStaticLoginForm(root, { messages, isAppPath, fallbackPath, navigate? })` for plain site scripts. It wires `form[data-login-form="credentials"]` (email, password), `form[data-login-form="mfa"]` (code) with `[data-login-mfa-back]`, an optional `a[data-login-forgot]` and `[data-error]` slots: empty-field checks, busy state, MFA challenge switch, failure messages and the post-login redirect through `postLoginPath`. `loginFailureMessageKey`, `LOGIN_FAILURE_MESSAGE_KEYS` and `isLoginFailureMessages` map server reasons to the seven message keys the page provides.
-->
