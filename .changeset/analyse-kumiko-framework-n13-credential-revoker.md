---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-dev-server": minor
---

Password changes and MFA state changes revoke sessions and access tokens through a new auth-foundation extension point, in the same transaction, without boot wiring.

<!-- kumiko-changes
feature: auth-foundation
type: breaking
title: credentialRevoker extension point replaces the session mass-revoke callbacks
detail: New `EXT_CREDENTIAL_REVOKER`, `CredentialRevoker`, `isCredentialRevoker` and `revokeAllUserCredentials(registry, runner, userId, { keepSessionId })`. sessions and personal-access-tokens register as providers; a password change (user feature postSave hook, in transaction) and every MFA state change call all providers in the triggering transaction, so a failing revoke rolls the change back. `SessionStore` loses `massRevoker` and `revokeAllOthers`; removed export: `SessionMassRevoker`.
migration: Drop `massRevoker` and `revokeAllOthers` from custom sessionStore providers. A custom credential store registers `r.useExtension(EXT_CREDENTIAL_REVOKER, "<key>", { revokeAllForUser })`.
-->

<!-- kumiko-changes
feature: sessions
type: breaking
title: autoRevokeOnPasswordChange option and late binding removed
detail: Sessions are revoked on password change through the auth-foundation credentialRevoker, synchronously in the user write's transaction. Removed: the `autoRevokeOnPasswordChange` option, `bindAutoRevokeFromFeature`, `BindAutoRevokeOnPasswordChange`, `SessionMassRevoker`, the `sessionMassRevoker` and `sessionRevokeAllOthers` fields of `createSessionCallbacks()`, and `asMassRevoker` from `sessionCallbacksFromLateBound`.
migration: Remove `autoRevokeOnPasswordChange` from `createSessionsFeature(...)` and every `bindAutoRevokeFromFeature(...)`/`asMassRevoker()` call; nothing replaces them.
-->

<!-- kumiko-changes
feature: personal-access-tokens
type: breaking
title: PAT auto-revoke option and late binding removed
detail: Access tokens are revoked on password change and MFA state change through the auth-foundation credentialRevoker. Removed: the `autoRevokeOnPasswordChange` option, `bindPatAutoRevokeOnPasswordChangeFromFeature`, `BindPatAutoRevokeOnPasswordChange`. `revokeAllPatTokensForUser` stays.
migration: Remove the option and the bind call; nothing replaces them.
-->

<!-- kumiko-changes
feature: auth-mfa
type: breaking
title: MFA revoke bindings removed; regenerate-recovery also revokes access tokens
detail: enable-confirm, enable-confirm-preauth, disable and regenerate-recovery revoke every other session and all access tokens through the auth-foundation credentialRevoker in their own transaction. Removed: `bindMfaRevokeAllOtherSessionsFromFeature`, `bindRevokeAllPatTokensFromFeature`, `BindMfaRevokeAllOtherSessions`, `BindRevokeAllPatTokens`.
migration: Remove the bind calls; mount auth-foundation with sessions and personal-access-tokens as before.
-->

<!-- kumiko-changes
feature: shared
type: breaking
title: late-bound slot helper removed
detail: Removed exports: `createLateBoundSlot`, `LateBoundSlot`; their only users were the removed revoke bindings.
migration: None for apps.
-->

<!-- kumiko-changes
feature: framework
type: breaking
title: SessionMassRevoker type removed
detail: Removed export: `SessionMassRevoker` from the api entry point; mass revocation runs through the auth-foundation credentialRevoker.
migration: Use `CredentialRevoker` from auth-foundation.
-->
