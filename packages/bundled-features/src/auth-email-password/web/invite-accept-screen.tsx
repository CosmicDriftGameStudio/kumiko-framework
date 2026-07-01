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

import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type FormEvent, type ReactNode, useContext, useState } from "react";
import { csrfHeader } from "./auth-client";
import { AuthCard, authMutedLinkClass, parseUrlToken } from "./auth-form-primitives";
import { SessionContext, UNAUTHENTICATED } from "./session";

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
  const { Form, Field, Input, Button, Banner } = usePrimitives();
  // NOT useSession(): InviteAcceptScreen is a public route (anon invite-links
  // are the documented use case) — useSession() throws without a
  // <SessionProvider> ancestor. Read the context directly and fall back to
  // the anonymous state when no provider wraps this screen (632/1).
  const session = useContext(SessionContext) ?? UNAUTHENTICATED;
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
        typeof loggedInHref === "function"
          ? loggedInHref({ tenantId: data.tenantId })
          : loggedInHref;
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
        typeof loggedInHref === "function"
          ? loggedInHref({ tenantId: data.tenantId })
          : loggedInHref;
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
        typeof loggedInHref === "function"
          ? loggedInHref({ tenantId: data.tenantId })
          : loggedInHref;
      window.location.assign(target);
      return;
    }
    setError(t("auth.errors.invalidInviteToken"));
  };

  const onSubmit = (e?: FormEvent): void => {
    e?.preventDefault();
    if (mode === "loggedin") {
      void acceptLoggedIn();
      return;
    }
    if (mode === "anon-existing") {
      void acceptAnonExisting();
      return;
    }
    void acceptAnonNew();
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
      <div className="p-6 pt-0 flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t("auth.inviteAccept.intro")}</p>

        {mode === "loggedin" ? (
          <Form onSubmit={onSubmit}>
            <p className="text-sm">{t("auth.inviteAccept.loggedInAs")}</p>
            {error !== null && <Banner variant="error">{error}</Banner>}
            <Button type="submit" loading={submitting} disabled={submitting}>
              {submitting ? t("auth.inviteAccept.submitting") : t("auth.inviteAccept.acceptButton")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setMode("anon-existing");
              }}
            >
              {t("auth.inviteAccept.useOtherAccount")}
            </Button>
          </Form>
        ) : (
          <Form onSubmit={onSubmit}>
            {mode === "anon-existing" && (
              <Field id="invite-email" label={t("auth.inviteAccept.email")} required>
                <Input
                  kind="email"
                  id="invite-email"
                  name="invite-email"
                  value={email}
                  onChange={setEmail}
                  disabled={submitting}
                  required
                  autoComplete="email"
                />
              </Field>
            )}
            <Field id="invite-password" label={t("auth.inviteAccept.password")} required>
              <Input
                kind="password"
                id="invite-password"
                name="invite-password"
                value={password}
                onChange={setPassword}
                disabled={submitting}
                required
                autoComplete={mode === "anon-existing" ? "current-password" : "new-password"}
              />
            </Field>
            {error !== null && <Banner variant="error">{error}</Banner>}
            <Button type="submit" loading={submitting} disabled={submitting}>
              {submitting ? t("auth.inviteAccept.submitting") : t("auth.inviteAccept.submit")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setMode(mode === "anon-existing" ? "anon-new" : "anon-existing");
                setError(null);
              }}
            >
              {mode === "anon-existing"
                ? t("auth.inviteAccept.toggleNew")
                : t("auth.inviteAccept.toggleExisting")}
            </Button>
          </Form>
        )}
      </div>
    </AuthCard>
  );
}
