// Reads `?token=...` from the URL, auto-posts it on mount and shows success/error.
//
// Tokens can be single-use server-side (verify-email), so the once-guard keeps Strict Mode's
// double effect from showing an invalid-token error after a successful first call.

import { usePrimitives } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { AuthCard, useUrlToken } from "./auth-form-primitives.tsx";

export type TokenConfirmLabels = {
  readonly errorTitle: string;
  readonly missingToken: string;
  readonly goToLogin: string;
  readonly verifying: string;
  readonly successTitle: string;
  readonly successBody: string;
  readonly errorBody: string;
};

export type TokenConfirmScreenProps = {
  readonly title?: string | undefined;
  readonly token?: string | undefined;
  readonly loginHref: string;
  readonly confirm: (token: string) => Promise<{ readonly ok: boolean }>;
  readonly labels: TokenConfirmLabels;
};

type Status = "verifying" | "success" | "error" | "missing-token";

export function TokenConfirmScreen({
  title,
  token: tokenProp,
  loginHref,
  confirm,
  labels,
}: TokenConfirmScreenProps): ReactNode {
  const { Link } = usePrimitives();
  const token = useUrlToken(tokenProp);
  const [status, setStatus] = useState<Status>(token === "" ? "missing-token" : "verifying");
  const startedRef = useRef(false);

  // biome-ignore lint/plugin: not yet converted to the framework hook set
  useEffect(() => {
    if (status !== "verifying") return;
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      const res = await confirm(token);
      setStatus(res.ok ? "success" : "error");
    })();
  }, [status, token, confirm]);

  if (status === "missing-token") {
    return (
      <AuthCard title={title ?? labels.errorTitle}>
        <p className="text-sm text-muted-foreground">{labels.missingToken}</p>
        <Link href={loginHref} variant="muted">
          {labels.goToLogin}
        </Link>
      </AuthCard>
    );
  }

  if (status === "verifying") {
    return (
      <AuthCard>
        <div className="p-6">
          <p className="text-sm text-muted-foreground" role="status">
            {labels.verifying}
          </p>
        </div>
      </AuthCard>
    );
  }

  if (status === "success") {
    return (
      <AuthCard title={title ?? labels.successTitle}>
        <p className="text-sm text-muted-foreground">{labels.successBody}</p>
        <Link href={loginHref} variant="button">
          {labels.goToLogin}
        </Link>
      </AuthCard>
    );
  }

  // status === "error"
  return (
    <AuthCard title={title ?? labels.errorTitle}>
      <p className="text-sm text-muted-foreground">{labels.errorBody}</p>
      <Link href={loginHref} variant="muted">
        {labels.goToLogin}
      </Link>
    </AuthCard>
  );
}
