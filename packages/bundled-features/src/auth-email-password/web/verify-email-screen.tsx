// VerifyEmailScreen — reads `?token=...` from the URL and automatically sends it to
// /api/auth/verify-email on mount, then shows success/error. The server-side
// operation is idempotent (repeating it sets emailVerified=true again), so
// retries are safe.
//
// The empty-deps effect and once guard prevent React Strict Mode from firing
// the verification call twice (Strict Mode dispatches useEffect twice in dev).
// The token roundtrip is single-use server-side, but this avoids showing an
// invalid-token banner after the first valid mount call.

import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { verifyEmail } from "./auth-client.ts";
import { AuthCard, useUrlToken } from "./auth-form-primitives.tsx";

export type VerifyEmailScreenProps = {
  readonly title?: string;
  /** Override the token from the URL. Default: parsed from `?token=...`. */
  readonly token?: string;
  /** href for the "Zum Login" link. Default "/login". */
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

  // kumiko-lint-ignore no-raw-hooks not yet converted to the framework hook set
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
        <p className="text-sm text-muted-foreground">{t("auth.verifyEmail.missingToken")}</p>
        <Link href={loginHref} variant="muted">
          {t("auth.verifyEmail.goToLogin")}
        </Link>
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
        <p className="text-sm text-muted-foreground">{t("auth.verifyEmail.successBody")}</p>
        <Link href={loginHref} variant="button">
          {t("auth.verifyEmail.goToLogin")}
        </Link>
      </AuthCard>
    );
  }

  // status === "error"
  return (
    <AuthCard title={title ?? t("auth.verifyEmail.errorTitle")}>
      <p className="text-sm text-muted-foreground">{t("auth.verifyEmail.errorBody")}</p>
      <Link href={loginHref} variant="muted">
        {t("auth.verifyEmail.goToLogin")}
      </Link>
    </AuthCard>
  );
}
