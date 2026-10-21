// Session state for the browser renderer. Holds the currently signed-in
// user (profile + active tenant assignment + memberships), responds to
// login/logout/tenant switching, and refreshes the data automatically.
//
// Context + useReducer is used instead of, for example, Zustand because
// the state is small (a handful of fields and a few transitions), avoiding
// another dependency in the browser bundle. Consumers live under
// `<SessionProvider>`; the `useSession()` hook provides the state
// and transitions.

import {
  type CurrentUser,
  CurrentUserProvider,
  useSessionEndedSignal,
} from "@cosmicdrift/kumiko-renderer";
import { readCsrfToken } from "@cosmicdrift/kumiko-renderer/live";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  AuthRequestError,
  type CurrentUserProfile,
  fetchCurrentUser,
  fetchTenants,
  type LoginRequest,
  type LoginResult,
  login as loginApi,
  logout as logoutApi,
  switchTenant as switchTenantApi,
  type TenantSummary,
} from "./auth-client.ts";

export type SessionStatus = "loading" | "unauthenticated" | "authenticated" | "error";

// httpStatus null means the fetch itself threw (offline/DNS/CORS), not that the server answered.
export type SessionBootstrapFailure = {
  readonly httpStatus: number | null;
  readonly retryAfterSeconds: number | null;
  readonly failedAtEpochMs: number;
};

export type SessionState = {
  readonly status: SessionStatus;
  readonly user: CurrentUserProfile | null;
  readonly activeTenantId: string | null;
  readonly tenants: readonly TenantSummary[];
  /** Merged session roles for the active tenant: globalRoles (for example,
   *  SystemAdmin) plus the active tenant's membership roles. The server has
   *  already merged them into the JWT, but the JWT is HttpOnly and cannot be
   *  read by JavaScript; the client computes the same merge from
   *  user.globalRoles + tenants[active].roles so navigation filtering works.
   *  The result is deduplicated. */
  readonly roles: readonly string[];
  readonly bootstrapFailure: SessionBootstrapFailure | null;
  /** Set when an authenticated session was ended server-side (revoked,
   *  expired) so the login screen can explain why it appeared. Optional so
   *  SessionApi values apps build themselves (test doubles) stay valid. */
  readonly signedOutReason?: "session-ended" | null;
};

export type SessionApi = SessionState & {
  readonly login: (req: LoginRequest) => Promise<LoginResult>;
  readonly logout: () => Promise<void>;
  readonly switchTenant: (tenantId: string) => Promise<void>;
  /** Re-runs the /auth/tenants + user:me refresh round without a full page
   *  reload. Used by auth-mfa's verify screen after a challenge completes
   *  and mints cookies via a route session.tsx never calls directly. */
  readonly refresh: () => Promise<void>;
};

// Exported so screens that render on BOTH authenticated and anonymous public
// routes (e.g. InviteAcceptScreen) can read `.status` without requiring a
// <SessionProvider> ancestor — see useContext(SessionContext) ?? UNAUTHENTICATED
// in invite-accept-screen.tsx (632/1).
export const UNAUTHENTICATED: SessionState = {
  status: "unauthenticated",
  user: null,
  activeTenantId: null,
  tenants: [],
  roles: [],
  bootstrapFailure: null,
  signedOutReason: null,
};

const INITIAL: SessionState = {
  status: "loading",
  user: null,
  activeTenantId: null,
  tenants: [],
  roles: [],
  bootstrapFailure: null,
  signedOutReason: null,
};

// kumiko_auth is HttpOnly; kumiko_csrf is set together with it at login.
export function hasLikelyAuthSession(cookieSource?: string): boolean {
  return readCsrfToken(cookieSource) !== undefined;
}

// Exported so tests can pin the merge path directly: this must be
// byte-identical to the server-side merge in auth-routes.ts +
// login.write.ts, otherwise the client sees different session roles
// from the server.
export function computeActiveRoles(
  user: CurrentUserProfile | null,
  activeTenantId: string | null,
  tenants: readonly TenantSummary[],
): readonly string[] {
  if (user === null) return [];
  const membership =
    activeTenantId !== null ? tenants.find((t) => t.tenantId === activeTenantId) : undefined;
  const membershipRoles = membership?.roles ?? [];
  // Set-Dedupe spiegelt server-side merge (auth-routes.ts switch-tenant +
  // login.write.ts).
  return Array.from(new Set([...user.globalRoles, ...membershipRoles]));
}

/** Internal — exposed so tests can pass a mock SessionApi value
 *  without going through SessionProvider's refresh lifecycle. Application
 *  code uses SessionProvider + useSession; direct context access is
 *  intended for tests/stories. */
export const SessionContext = createContext<SessionApi | undefined>(undefined);

// One refresh round: /auth/tenants → if 401, unauthenticated; otherwise
// /user:me. Together, both requests produce the complete SessionState.
async function refresh(): Promise<SessionState> {
  if (!hasLikelyAuthSession()) {
    return UNAUTHENTICATED;
  }
  const tenants = await fetchTenants();
  if (tenants === null) {
    return UNAUTHENTICATED;
  }
  const user = await fetchCurrentUser();
  if (user === null) {
    return UNAUTHENTICATED;
  }
  return {
    status: "authenticated",
    user,
    activeTenantId: tenants.activeTenantId,
    tenants: tenants.tenants,
    roles: computeActiveRoles(user, tenants.activeTenantId, tenants.tenants),
    bootstrapFailure: null,
    signedOutReason: null,
  };
}

// Non-AuthRequestError throws (offline, DNS, CORS) have no status, so httpStatus stays null.
function toBootstrapFailure(err: unknown): SessionBootstrapFailure {
  if (err instanceof AuthRequestError) {
    return {
      httpStatus: err.status,
      retryAfterSeconds: err.retryAfterSeconds ?? null,
      failedAtEpochMs: Date.now(),
    };
  }
  return { httpStatus: null, retryAfterSeconds: null, failedAtEpochMs: Date.now() };
}

export function SessionProvider({
  children,
  postLogoutUrl,
}: {
  readonly children: ReactNode;
  /** Logout navigates here instead of reloading. Validated by makeSessionAuthGate. */
  readonly postLogoutUrl?: string;
}): ReactNode {
  const [state, setState] = useState<SessionState>(INITIAL);

  // Never rejects, so bootstrap can't strand the UI on "loading" forever.
  const doRefresh = useCallback(async () => {
    try {
      const next = await refresh();
      setState(next);
    } catch (err) {
      setState({ ...UNAUTHENTICATED, status: "error", bootstrapFailure: toBootstrapFailure(err) });
    }
  }, []);

  // kumiko-lint-ignore no-raw-hooks not yet converted to the framework hook set
  useEffect(() => {
    void doRefresh();
  }, [doRefresh]);

  const sessionEndedSignal = useSessionEndedSignal();
  // Only an authenticated session can "end": an anonymous 401 on a public
  // surface must not show the hint.
  // kumiko-lint-ignore no-raw-hooks not yet converted to the framework hook set
  useEffect(() => {
    return sessionEndedSignal?.subscribe(() => {
      setState((prev) =>
        prev.status === "authenticated"
          ? { ...UNAUTHENTICATED, signedOutReason: "session-ended" }
          : prev,
      );
    });
  }, [sessionEndedSignal]);

  const login = useCallback<SessionApi["login"]>(
    async (req) => {
      const res = await loginApi(req);
      if (res.kind === "success") {
        await doRefresh();
      }
      return res;
    },
    [doRefresh],
  );

  const logout = useCallback<SessionApi["logout"]>(async () => {
    await logoutApi();
    if (postLogoutUrl !== undefined && typeof window !== "undefined") {
      // State stays untouched: flipping to unauthenticated would let an AuthGate
      // with loginUrl race this navigation to its own redirect.
      window.location.assign(postLogoutUrl);
      return;
    }
    setState(UNAUTHENTICATED);
    // Hard reload: the React tree, dispatcher live caches, and EventSource
    // are all reset. After logout, this is the cheapest way to reach a clean
    // state without having to invalidate every consumer through a context
    // reset.
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  }, [postLogoutUrl]);

  const switchTenant = useCallback<SessionApi["switchTenant"]>(async (tenantId) => {
    await switchTenantApi(tenantId);
    // Tenant switching rotates the JWT + cookies. The React tree contains
    // tenant-bound caches (queries, live events), so a simple reload is
    // consistent with the logout path and avoids partial state transitions.
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  }, []);

  const api: SessionApi = { ...state, login, logout, switchTenant, refresh: doRefresh };
  // Keyed on the primitives, not the profile object: every refresh (tenant
  // switch, session bootstrap retry) builds a new profile object, and a new
  // CurrentUser reference would re-seed a create form and drop typed input.
  const profile = state.user;
  const userId = profile?.id;
  const userEmail = profile?.email;
  const userDisplayName = profile?.displayName;
  const userTimeZone = profile?.effectiveTimeZone;
  const currentUser = useMemo<CurrentUser | undefined>(
    () =>
      userId === undefined || userEmail === undefined || userDisplayName === undefined
        ? undefined
        : {
            id: userId,
            email: userEmail,
            displayName: userDisplayName,
            ...(userTimeZone !== undefined && { timeZone: userTimeZone }),
          },
    [userId, userEmail, userDisplayName, userTimeZone],
  );
  return (
    <SessionContext.Provider value={api}>
      <CurrentUserProvider user={currentUser}>{children}</CurrentUserProvider>
    </SessionContext.Provider>
  );
}

export function useSession(): SessionApi {
  const ctx = useContext(SessionContext);
  if (ctx === undefined) {
    throw new Error("useSession must be used inside <SessionProvider>");
  }
  return ctx;
}
