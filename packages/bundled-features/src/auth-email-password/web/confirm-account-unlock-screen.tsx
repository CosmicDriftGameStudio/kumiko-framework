// @runtime client
// ConfirmAccountUnlockScreen — reads `?token=...` from the URL, auto-posts
// it to /api/auth/confirm-account-unlock on mount, shows success/error.
// Idempotent server-side (clearLockoutState is a no-op when already
// unlocked), so no re-submit risk. Mirrors VerifyEmailScreen 1:1.
//
// useEffect with empty deps + a once-guard so React Strict Mode's double
// useEffect dispatch in dev fires the confirm call only once.

import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { confirmAccountUnlock } from "./auth-client";
import { AuthCard, useUrlToken } from "./auth-form-primitives";

export type ConfirmAccountUnlockScreenProps = {
  readonly title?: string;
  /** Override for the token from the URL. Default: parsed from `?token=...`. */
  readonly token?: string;
  /** href for the "go to sign in" link. Default "/login". */
  readonly loginHref?: string;
};

type Status = "verifying" | "success" | "error" | "missing-token";

export function ConfirmAccountUnlockScreen({
  title,
  token: tokenProp,
  loginHref = "/login",
}: ConfirmAccountUnlockScreenProps): ReactNode {
  const t = useTranslation();
  const { Link } = usePrimitives();
  const token = useUrlToken(tokenProp);
  const [status, setStatus] = useState<Status>(token === "" ? "missing-token" : "verifying");
  const startedRef = useRef(false);

  useEffect(() => {
    if (status !== "verifying") return;
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      const res = await confirmAccountUnlock(token);
      setStatus(res.ok ? "success" : "error");
    })();
  }, [status, token]);

  if (status === "missing-token") {
    return (
      <AuthCard title={title ?? t("auth.unlockAccount.errorTitle")}>
        <div className="p-6 pt-0 flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{t("auth.unlockAccount.missingToken")}</p>
          <Link href={loginHref} variant="muted">
            {t("auth.unlockAccount.goToLogin")}
          </Link>
        </div>
      </AuthCard>
    );
  }

  if (status === "verifying") {
    return (
      <AuthCard>
        <div className="p-6">
          <p className="text-sm text-muted-foreground" role="status">
            {t("auth.unlockAccount.verifying")}
          </p>
        </div>
      </AuthCard>
    );
  }

  if (status === "success") {
    return (
      <AuthCard title={title ?? t("auth.unlockAccount.successTitle")}>
        <div className="p-6 pt-0 flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{t("auth.unlockAccount.successBody")}</p>
          <Link href={loginHref} variant="button">
            {t("auth.unlockAccount.goToLogin")}
          </Link>
        </div>
      </AuthCard>
    );
  }

  // status === "error"
  return (
    <AuthCard title={title ?? t("auth.unlockAccount.errorTitle")}>
      <div className="p-6 pt-0 flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t("auth.unlockAccount.errorBody")}</p>
        <Link href={loginHref} variant="muted">
          {t("auth.unlockAccount.goToLogin")}
        </Link>
      </div>
    </AuthCard>
  );
}
