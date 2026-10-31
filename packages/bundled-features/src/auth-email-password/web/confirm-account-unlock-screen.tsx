// ConfirmAccountUnlockScreen — reads `?token=...` from the URL, auto-posts
// it to /api/auth/confirm-account-unlock on mount, shows success/error.
// Idempotent server-side (clearLockoutState is a no-op when already
// unlocked), so no re-submit risk. Mirrors VerifyEmailScreen 1:1.

import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { confirmAccountUnlock } from "./auth-client.ts";
import { TokenConfirmScreen } from "./token-confirm-screen.tsx";

export type ConfirmAccountUnlockScreenProps = {
  readonly title?: string;
  /** Override for the token from the URL. Default: parsed from `?token=...`. */
  readonly token?: string;
  /** href for the "go to sign in" link. Default "/login". */
  readonly loginHref?: string;
};

// guard:dup-ok TokenConfirmScreen holds the logic; each screen only supplies its own literal label keys
export function ConfirmAccountUnlockScreen({
  title,
  token,
  loginHref = "/login",
}: ConfirmAccountUnlockScreenProps): ReactNode {
  const t = useTranslation();
  return (
    <TokenConfirmScreen
      title={title}
      token={token}
      loginHref={loginHref}
      confirm={confirmAccountUnlock}
      labels={{
        errorTitle: t("auth.unlockAccount.errorTitle"),
        missingToken: t("auth.unlockAccount.missingToken"),
        goToLogin: t("auth.unlockAccount.goToLogin"),
        verifying: t("auth.unlockAccount.verifying"),
        successTitle: t("auth.unlockAccount.successTitle"),
        successBody: t("auth.unlockAccount.successBody"),
        errorBody: t("auth.unlockAccount.errorBody"),
      }}
    />
  );
}
