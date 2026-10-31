// VerifyEmailScreen — reads `?token=...` from the URL and automatically sends it to
// /api/auth/verify-email on mount, then shows success/error. The server-side
// operation is idempotent (repeating it sets emailVerified=true again), so
// retries are safe.

import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { verifyEmail } from "./auth-client.ts";
import { TokenConfirmScreen } from "./token-confirm-screen.tsx";

export type VerifyEmailScreenProps = {
  readonly title?: string;
  /** Override the token from the URL. Default: parsed from `?token=...`. */
  readonly token?: string;
  /** href for the "Zum Login" link. Default "/login". */
  readonly loginHref?: string;
};

// guard:dup-ok TokenConfirmScreen holds the logic; each screen only supplies its own literal label keys
export function VerifyEmailScreen({
  title,
  token,
  loginHref = "/login",
}: VerifyEmailScreenProps): ReactNode {
  const t = useTranslation();
  return (
    <TokenConfirmScreen
      title={title}
      token={token}
      loginHref={loginHref}
      confirm={verifyEmail}
      labels={{
        errorTitle: t("auth.verifyEmail.errorTitle"),
        missingToken: t("auth.verifyEmail.missingToken"),
        goToLogin: t("auth.verifyEmail.goToLogin"),
        verifying: t("auth.verifyEmail.verifying"),
        successTitle: t("auth.verifyEmail.successTitle"),
        successBody: t("auth.verifyEmail.successBody"),
        errorBody: t("auth.verifyEmail.errorBody"),
      }}
    />
  );
}
