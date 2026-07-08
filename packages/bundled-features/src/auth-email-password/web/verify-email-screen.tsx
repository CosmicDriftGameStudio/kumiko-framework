// @runtime client
// VerifyEmailScreen — liest `?token=...` aus URL, schickt ihn auto an
// /api/auth/verify-email beim Mount, zeigt success/error. Idempotent
// auf Server-Seite (mehrfaches Klicken setzt emailVerified=true erneut),
// also kein Re-Submit-Risiko.
//
// useEffect mit empty-deps + once-Guard damit React Strict-Mode den
// Verify-Call nur einmal feuert (Strict-Mode dispatched useEffect 2x in
// dev). Token-roundtrip ist server-side single-use, aber wir wollen
// nicht den ersten valid-call beim Mount und den zweiten als invalid-
// Banner sehen.

import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { verifyEmail } from "./auth-client";
import { AuthCard, useUrlToken } from "./auth-form-primitives";

export type VerifyEmailScreenProps = {
  readonly title?: string;
  /** Override für Token aus URL. Default: parsed aus `?token=...`. */
  readonly token?: string;
  /** href für "Zum Login"-Link. Default "/login". */
  readonly loginHref?: string;
};

type Status = "verifying" | "success" | "error" | "missing-token";

export function VerifyEmailScreen({
  title,
  token: tokenProp,
  loginHref = "/login",
}: VerifyEmailScreenProps): ReactNode {
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
      const res = await verifyEmail(token);
      setStatus(res.ok ? "success" : "error");
    })();
  }, [status, token]);

  if (status === "missing-token") {
    return (
      <AuthCard title={title ?? t("auth.verifyEmail.errorTitle")}>
        <div className="p-6 pt-0 flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{t("auth.verifyEmail.missingToken")}</p>
          <Link href={loginHref} variant="muted">
            {t("auth.verifyEmail.goToLogin")}
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
            {t("auth.verifyEmail.verifying")}
          </p>
        </div>
      </AuthCard>
    );
  }

  if (status === "success") {
    return (
      <AuthCard title={title ?? t("auth.verifyEmail.successTitle")}>
        <div className="p-6 pt-0 flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{t("auth.verifyEmail.successBody")}</p>
          <Link href={loginHref} variant="button">
            {t("auth.verifyEmail.goToLogin")}
          </Link>
        </div>
      </AuthCard>
    );
  }

  // status === "error"
  return (
    <AuthCard title={title ?? t("auth.verifyEmail.errorTitle")}>
      <div className="p-6 pt-0 flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t("auth.verifyEmail.errorBody")}</p>
        <Link href={loginHref} variant="muted">
          {t("auth.verifyEmail.goToLogin")}
        </Link>
      </div>
    </AuthCard>
  );
}
