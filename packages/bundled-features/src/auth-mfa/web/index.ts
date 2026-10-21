// Public exports for the browser side of the auth-mfa feature. The subpath
// export `@cosmicdrift/kumiko-bundled-features/auth-mfa/web` keeps the server
// side (`defineFeature`) free of React/DOM dependencies, matching the same
// separation in auth-email-password/web/index.ts.

export type { AuthMfaClientFeature, AuthMfaClientOptions } from "./client-plugin.ts";
export { authMfaClient } from "./client-plugin.ts";
export { defaultTranslations, mergeTranslations } from "./i18n.ts";
export type {
  MfaSetupPreauthStart,
  MfaSetupPreauthStartResult,
  MfaVerifyResult,
} from "./mfa-client.ts";
export { confirmMfaSetupPreauth, startMfaSetupPreauth, verifyMfaChallenge } from "./mfa-client.ts";
export type { MfaDisableDialogProps } from "./mfa-disable-dialog.tsx";
export { MfaDisableDialog } from "./mfa-disable-dialog.tsx";
export type { MfaRecoveryCodesRevealProps } from "./mfa-recovery-codes-reveal.tsx";
export { MfaRecoveryCodesReveal } from "./mfa-recovery-codes-reveal.tsx";
export type { MfaRegenerateRecoveryDialogProps } from "./mfa-regenerate-recovery-dialog.tsx";
export { MfaRegenerateRecoveryDialog } from "./mfa-regenerate-recovery-dialog.tsx";
export type { MfaSetupPreauthScreenProps } from "./mfa-setup-preauth-screen.tsx";
export { MfaSetupPreauthScreen } from "./mfa-setup-preauth-screen.tsx";
export type { MfaVerifyScreenProps } from "./mfa-verify-screen.tsx";
export { MfaVerifyScreen } from "./mfa-verify-screen.tsx";
