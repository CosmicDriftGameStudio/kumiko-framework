// InviteAcceptScreen — accepts tenant invitations through a magic link.
//
// Reads `?token=...` from the URL and selects a flow based on session state:
//   - Logged in with a matching email: one-click accept (Branch 1, via the
//     invite-accept dispatcher). For an email mismatch, show an error and a
//     "Sign in with a different account" link.
//   - Anonymous: email and password form. The "Already have an account?" toggle
//     selects Branch 2 (existing user, login + accept) or Branch 3 (new user,
//     signup + accept).
//
// Anti-enumeration: invalidInviteToken collapses token, user, and password
// failures into one code, using the same trade-off as reset.
//
// Auto-login: Branches 2 and 3 set cookies through the server, then the
// frontend redirects to loggedInHref. Branch 1 already has a session, but the
// frontend also redirects to loggedInHref so the invitee enters the new tenant.

import {
  useOptionalDispatcher,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { type FormEvent, type ReactNode, useContext, useState } from "react";
import { csrfHeader } from "./auth-client.ts";
import { resolvePostAuthHref } from "./auth-form-logic.ts";
import { AuthCard, useUrlToken } from "./auth-form-primitives.tsx";
import { AuthErrors, AuthQueries } from "./constants.ts";
import { failureFromErrorField, isRecord, type LoginFailure } from "./login-failure.ts";
import { reasonToKey } from "./login-screen.tsx";
import { SessionContext, UNAUTHENTICATED } from "./session.tsx";

export type InviteAcceptScreenProps = {
  readonly title?: string;
  readonly token?: string;
  /** Where to redirect on success. Default "/" — multi-tenant apps can pass
   *  `(data) => "/${data.tenantId}/"`. Function-form receives the roles this
   *  flow grants in the target tenant; branch 1 reports the invitation's
   *  role, which for an existing member is not their full role set there.
   *  @deprecated Removed in 0.390.0. Configure auth.postAuthLanding on the server; its landingPath wins.
   *  Kept as fallback until 0.390.0. */
  readonly loggedInHref?:
    | string
    | ((args: { tenantId: string; roles: readonly string[] }) => string);
  /** Login href for "Mit anderem Account anmelden". Default "/login". */
  readonly loginHref?: string;
};

type Mode = "loggedin" | "anon-existing" | "anon-new";

// All three accept routes answer 200 with tenantId + the invitation role;
// the two session-minting branches additionally carry the stripped session
// roles. An MFA challenge is also a 200 and carries none of them.
type InviteAcceptMfaPending = {
  readonly tenantId?: undefined;
  readonly mfaRequired?: boolean;
  readonly mfaSetupRequired?: boolean;
};

type InviteAcceptSucceeded = {
  readonly tenantId: string;
  readonly role?: string;
  readonly user?: { readonly roles?: readonly string[] };
  // Present only when the server's auth.postAuthLanding resolver returned a
  // valid path — see auth-routes.ts.
  readonly landingPath?: string;
};

type InviteAcceptResponse = InviteAcceptMfaPending | InviteAcceptSucceeded;

function isMfaPending(data: InviteAcceptResponse): data is InviteAcceptMfaPending {
  return data.tenantId === undefined;
}

type InviteInfo = { readonly email: string; readonly hasAccount: boolean };

type InviteInfoState =
  | { readonly kind: "pending" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "invalid" }
  | { readonly kind: "ready"; readonly info: InviteInfo };

async function failureFromResponse(res: Response): Promise<LoginFailure> {
  if (res.status === 429) return { reason: "rate_limited" };
  const body: unknown = await res.json().catch(() => null);
  return failureFromErrorField(isRecord(body) ? body["error"] : undefined, "unknown_error");
}

function grantedRoles(data: InviteAcceptSucceeded): readonly string[] {
  if (data.user?.roles !== undefined) return data.user.roles;
  return data.role === undefined ? [] : [data.role];
}

// Without a mounted dispatcher (standalone mounts, tests) the lookup is skipped and the
// form behaves as before; so does any lookup failure except an invalid token.
function InviteAcceptWithLookup(props: InviteAcceptBodyProps): ReactNode {
  const { data, error, loading } = useQuery<InviteInfo>(
    AuthQueries.inviteInfo,
    { token: props.token },
    { enabled: props.token !== "" },
  );
  const inviteInfo: InviteInfoState =
    data !== null
      ? { kind: "ready", info: data }
      : error !== null
        ? error.details?.["reason"] === AuthErrors.invalidInviteToken
          ? { kind: "invalid" }
          : { kind: "unavailable" }
        : loading
          ? { kind: "pending" }
          : { kind: "unavailable" };
  return <InviteAcceptBody {...props} inviteInfo={inviteInfo} />;
}

export function InviteAcceptScreen({
  token: tokenProp,
  ...rest
}: InviteAcceptScreenProps): ReactNode {
  const token = useUrlToken(tokenProp);
  const dispatcher = useOptionalDispatcher();
  return dispatcher === undefined ? (
    <InviteAcceptBody {...rest} token={token} inviteInfo={{ kind: "unavailable" }} />
  ) : (
    <InviteAcceptWithLookup {...rest} token={token} />
  );
}

type InviteAcceptBodyProps = Omit<InviteAcceptScreenProps, "token"> & { readonly token: string };

function InviteAcceptBody({
  title,
  token,
  loggedInHref = "/",
  loginHref = "/login",
  inviteInfo,
}: InviteAcceptBodyProps & { readonly inviteInfo: InviteInfoState }): ReactNode {
  const t = useTranslation();
  const { Form, Field, Input, Button, Banner, Link } = usePrimitives();
  // NOT useSession(): InviteAcceptScreen is a public route (anon invite-links
  // are the documented use case) — useSession() throws without a
  // <SessionProvider> ancestor. Read the context directly and fall back to
  // the anonymous state when no provider wraps this screen (632/1).
  const session = useContext(SessionContext) ?? UNAUTHENTICATED;
  const [chosenMode, setMode] = useState<Mode | null>(null);
  const [typedEmail, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invitedEmail = inviteInfo.kind === "ready" ? inviteInfo.info.email : null;
  const email = invitedEmail ?? typedEmail;
  const defaultMode: Mode =
    session.status === "authenticated"
      ? "loggedin"
      : inviteInfo.kind === "ready" && !inviteInfo.info.hasAccount
        ? "anon-new"
        : "anon-existing";
  const mode = chosenMode ?? defaultMode;

  const effectiveTitle = title ?? t("auth.inviteAccept.title");

  // The invitation is already consumed when the server answers with an MFA
  // challenge / setup requirement, but no session cookie was minted: send the
  // user to the login screen (now a member) instead of a tenant URL.
  const finishAccept = (data: InviteAcceptResponse): void => {
    if (isMfaPending(data)) {
      window.location.assign(loginHref);
      return;
    }
    window.location.assign(
      resolvePostAuthHref(data.landingPath, loggedInHref, {
        tenantId: data.tenantId,
        roles: grantedRoles(data),
      }),
    );
  };

  const postInviteAccept = async (path: string, body: Record<string, string>): Promise<void> => {
    setSubmitting(true);
    setError(null);
    // biome-ignore lint/plugin: not yet converted to the framework hook set
    const res = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...csrfHeader() },
      body: JSON.stringify(body),
    });
    setSubmitting(false);
    if (res.ok) {
      // @cast-boundary engine-payload — auth route JSON
      const data = (await res.json()) as InviteAcceptResponse;
      finishAccept(data);
      return;
    }
    const { key, params } = reasonToKey(await failureFromResponse(res), "auth.errors.unknownError");
    setError(t(key, params));
  };

  const acceptLoggedIn = (): Promise<void> =>
    postInviteAccept("/api/auth/invite-accept", { token });

  const acceptAnonExisting = (): Promise<void> =>
    postInviteAccept("/api/auth/invite-accept-with-login", { token, email, password });

  const acceptAnonNew = (): Promise<void> =>
    postInviteAccept("/api/auth/invite-signup-complete", { token, password });

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
        <p className="text-sm text-muted-foreground">{t("auth.inviteAccept.missingToken")}</p>
        <Link href={loginHref} variant="muted">
          {t("auth.inviteAccept.goToLogin")}
        </Link>
      </AuthCard>
    );
  }

  if (inviteInfo.kind === "invalid") {
    return (
      <AuthCard title={effectiveTitle}>
        <Banner variant="error">{t("auth.errors.invalidInviteToken")}</Banner>
        <Link href={loginHref} variant="muted">
          {t("auth.inviteAccept.goToLogin")}
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={effectiveTitle}>
      <p className="text-sm text-muted-foreground">{t("auth.inviteAccept.intro")}</p>

      {mode === "loggedin" ? (
        <Form onSubmit={onSubmit}>
          <p className="text-sm">
            {t("auth.inviteAccept.loggedInAs", { email: session.user?.email ?? "" })}
          </p>
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
          {(mode === "anon-existing" || invitedEmail !== null) && (
            <Field id="invite-email" label={t("auth.inviteAccept.email")} required>
              <Input
                kind="email"
                id="invite-email"
                name="invite-email"
                value={email}
                onChange={setEmail}
                disabled={submitting || invitedEmail !== null}
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
    </AuthCard>
  );
}
