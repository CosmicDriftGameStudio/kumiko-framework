---
"@cosmicdrift/kumiko-bundled-features": minor
---

`auth-mfa/web` gains `MfaDisableDialog`, `MfaRegenerateRecoveryDialog`, and `MfaRecoveryCodesReveal` — the disable/regenerate-recovery UI deferred from the initial MFA-UI PR (kumiko-framework#266). Also fixes `MfaEnableScreen`'s error banner, which templated the raw snake_case server error code straight into the i18n key (`auth.mfa.errors.invalid_totp_code`) instead of the camelCase key actually registered (`auth.mfa.errors.invalidCode`) — extracted into a shared `mfaManageErrorKey` helper, now used by all three write-triggering components.
