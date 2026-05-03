// @runtime client
// InviteAcceptScreen — Magic-Link-Accept für Tenant-Invitations.
//
// Liest `?token=...` aus der URL und branched intern je nach session-state:
//   - Logged-in + Email-Match: 1-click accept (Branch 1, dispatcher
//     invite-accept). Bei Email-Mismatch zeigen wir die fehlermeldung
//     und einen "Mit anderem Account anmelden"-Link.
//   - Anonymous: Email + Password-Form. Toggle "Schon einen Account?"
//     entscheidet Branch 2 (existing user, login + accept) vs Branch 3
//     (neuer user, signup + accept).
//
// Anti-enumeration: invalidInviteToken collapsed alle Token/User/
// Password-Failures auf einen Code (gleicher Trade-off wie reset).
//
// Auto-Login: Branch 2+3 setzen Cookies via Server, Frontend redirected
// zu loggedInHref. Branch 1 hat schon eine Session — Frontend redirected
// auch zu loggedInHref damit der invitee in seinem neuen Tenant landet.

import { useTranslation } from "@kumiko/renderer";
import { type ReactNode, useState } from "react";
import { csrfHeader } from "./auth-client";
import {
  AuthBanner,
  AuthCard,
  AuthInput,
  authButtonClass,
  authMutedLinkClass,
  parseUrlToken,
} from "./auth-form-primitives";
import { useSession } from "./session";

export type InviteAcceptScreenProps = {
  readonly title?: string;
  readonly token?: string;
  /** Where to redirect on success. Default "/" — Apps mit Multi-Tenant-
   *  Routing können `(data) => "/${data.tenantId}/"` setzen. */
  readonly loggedInHref?: string | ((args: { tenantId: string }) => string);
  /** Login-Href für "Mit anderem Account anmelden". Default "/login". */
  readonly loginHref?: string;
};

type Mode = "loggedin" | "anon-existing" | "anon-new";

export function InviteAcceptScreen({
  title,
  token: tokenProp,
  loggedInHref = "/",
  loginHref = "/login",
}: InviteAcceptScreenProps): ReactNode {
  const t = useTranslation();
  const session = useSession();
  const [token] = useState(() => tokenProp ?? parseUrlToken());
  const [mode, setMode] = useState<Mode>(() =>
    session.status === "authenticated" ? "loggedin" : "anon-existing",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveTitle = title ?? t("auth.inviteAccept.title");

  const acceptLoggedIn = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/auth/invite-accept", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...csrfHeader() },
      body: JSON.stringify({ token }),
    });
    setSubmitting(false);
    if (res.ok) {
      const data = (await res.json()) as { tenantId: string };
      const target =
        typeof loggedInHref === "function" ? loggedInHref({ tenantId: data.tenantId }) : loggedInHref;
      window.location.assign(target);
      return;
    }
    setError(t("auth.errors.invalidInviteToken"));
  };

  const acceptAnonExisting = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/auth/invite-accept-with-login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...csrfHeader() },
      body: JSON.stringify({ token, email, password }),
    });
    setSubmitting(false);
    if (res.ok) {
      const data = (await res.json()) as { tenantId: string };
      const target =
        typeof loggedInHref === "function" ? loggedInHref({ tenantId: data.tenantId }) : loggedInHref;
      window.location.assign(target);
      return;
    }
    setError(t("auth.errors.invalidInviteToken"));
  };

  const acceptAnonNew = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/auth/invite-signup-complete", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...csrfHeader() },
      body: JSON.stringify({ token, password }),
    });
    setSubmitting(false);
    if (res.ok) {
      const data = (await res.json()) as { tenantId: string };
      const target =
        typeof loggedInHref === "function" ? loggedInHref({ tenantId: data.tenantId }) : loggedInHref;
      window.location.assign(target);
      return;
    }
    setError(t("auth.errors.invalidInviteToken"));
  };

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (mode === "loggedin") return acceptLoggedIn();
    if (mode === "anon-existing") return acceptAnonExisting();
    return acceptAnonNew();
  };

  if (token === "") {
    return (
      <AuthCard title={effectiveTitle}>
        <div className="p-6 pt-0 flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{t("auth.inviteAccept.missingToken")}</p>
          <a href={loginHref} className={authMutedLinkClass}>
            {t("auth.inviteAccept.goToLogin")}
          </a>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={effectiveTitle}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4 p-6 pt-0">
        <p className="text-sm text-muted-foreground">{t("auth.inviteAccept.intro")}</p>

        {mode === "loggedin" ? (
          <>
            <p className="text-sm">{t("auth.inviteAccept.loggedInAs")}</p>
            {error !== null && <AuthBanner tone="error">{error}</AuthBanner>}
            <button type="submit" disabled={submitting} className={authButtonClass}>
              {submitting ? t("auth.inviteAccept.submitting") : t("auth.inviteAccept.acceptButton")}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("anon-existing");
              }}
              className={authMutedLinkClass}
            >
              {t("auth.inviteAccept.useOtherAccount")}
            </button>
          </>
        ) : (
          <>
            {mode === "anon-existing" && (
              <AuthInput
                id="invite-email"
                label={t("auth.inviteAccept.email")}
                type="email"
                autoComplete="email"
                required
                disabled={submitting}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
            <AuthInput
              id="invite-password"
              label={t("auth.inviteAccept.password")}
              type="password"
              autoComplete={mode === "anon-existing" ? "current-password" : "new-password"}
              required
              minLength={8}
              disabled={submitting}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error !== null && <AuthBanner tone="error">{error}</AuthBanner>}
            <button type="submit" disabled={submitting} className={authButtonClass}>
              {submitting ? t("auth.inviteAccept.submitting") : t("auth.inviteAccept.submit")}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode(mode === "anon-existing" ? "anon-new" : "anon-existing");
                setError(null);
              }}
              className={authMutedLinkClass}
            >
              {mode === "anon-existing"
                ? t("auth.inviteAccept.toggleNew")
                : t("auth.inviteAccept.toggleExisting")}
            </button>
          </>
        )}
      </form>
    </AuthCard>
  );
}
