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

import { useTranslation } from "@kumiko/renderer";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { verifyEmail } from "./auth-client";

export type VerifyEmailScreenProps = {
  readonly title?: string;
  /** Override für Token aus URL. Default: parsed aus `?token=...`. */
  readonly token?: string;
  /** href für "Zum Login"-Link. Default "/login". */
  readonly loginHref?: string;
};

type Status = "verifying" | "success" | "error" | "missing-token";

function readTokenFromUrl(): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return params.get("token") ?? "";
}

export function VerifyEmailScreen({
  title,
  token: tokenProp,
  loginHref = "/login",
}: VerifyEmailScreenProps): ReactNode {
  const t = useTranslation();
  const [token] = useState(() => tokenProp ?? readTokenFromUrl());
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

  const cardWrapper = "min-h-screen flex items-center justify-center bg-background px-4";
  const card = "w-full max-w-sm rounded-lg border bg-card text-card-foreground shadow-sm p-6";

  if (status === "missing-token") {
    return (
      <div className={cardWrapper}>
        <div className={card}>
          <h1 className="text-xl font-semibold tracking-tight mb-4">
            {title ?? t("auth.verifyEmail.errorTitle")}
          </h1>
          <p className="text-sm text-muted-foreground mb-4">{t("auth.verifyEmail.missingToken")}</p>
          <a
            href={loginHref}
            className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
          >
            {t("auth.verifyEmail.goToLogin")}
          </a>
        </div>
      </div>
    );
  }

  if (status === "verifying") {
    return (
      <div className={cardWrapper}>
        <div className={card}>
          <p className="text-sm text-muted-foreground" role="status">
            {t("auth.verifyEmail.verifying")}
          </p>
        </div>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div className={cardWrapper}>
        <div className={card}>
          <h1 className="text-xl font-semibold tracking-tight mb-4">
            {title ?? t("auth.verifyEmail.successTitle")}
          </h1>
          <p className="text-sm text-muted-foreground mb-4">{t("auth.verifyEmail.successBody")}</p>
          <a
            href={loginHref}
            className="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-4 py-2"
          >
            {t("auth.verifyEmail.goToLogin")}
          </a>
        </div>
      </div>
    );
  }

  // status === "error"
  return (
    <div className={cardWrapper}>
      <div className={card}>
        <h1 className="text-xl font-semibold tracking-tight mb-4">
          {title ?? t("auth.verifyEmail.errorTitle")}
        </h1>
        <p className="text-sm text-muted-foreground mb-4">{t("auth.verifyEmail.errorBody")}</p>
        <a
          href={loginHref}
          className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
        >
          {t("auth.verifyEmail.goToLogin")}
        </a>
      </div>
    </div>
  );
}
