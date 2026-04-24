// Session-State für den Browser-Renderer. Hält den aktuell eingeloggten
// User (Profile + aktive Tenant-Zuordnung + Memberships), reagiert auf
// Login/Logout/Switch-Tenant und refresh't die Daten automatisch.
//
// Warum Context + useReducer statt z.B. Zustand? Weil die State-Menge
// klein ist (ein Handful Felder, ein paar Transitionen) und wir damit
// eine Dependency weniger im Browser-Bundle haben. Die Consumer leben
// unter `<SessionProvider>`; der `useSession()`-Hook liefert den State
// und die Transitions.

import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import {
  type CurrentUserProfile,
  fetchCurrentUser,
  fetchTenants,
  type LoginFailure,
  type LoginRequest,
  login as loginApi,
  logout as logoutApi,
  switchTenant as switchTenantApi,
  type TenantSummary,
} from "./auth-client";

export type SessionStatus = "loading" | "unauthenticated" | "authenticated";

export type SessionState = {
  readonly status: SessionStatus;
  readonly user: CurrentUserProfile | null;
  readonly activeTenantId: string | null;
  readonly tenants: readonly TenantSummary[];
};

export type SessionApi = SessionState & {
  readonly login: (req: LoginRequest) => Promise<{ ok: true } | { ok: false; error: LoginFailure }>;
  readonly logout: () => Promise<void>;
  readonly switchTenant: (tenantId: string) => Promise<void>;
};

const INITIAL: SessionState = {
  status: "loading",
  user: null,
  activeTenantId: null,
  tenants: [],
};

const SessionContext = createContext<SessionApi | undefined>(undefined);

// Eine Refresh-Runde: /auth/tenants → wenn 401 nicht-eingeloggt, sonst
// parallel /user:me. Beides zusammen ergibt den vollen SessionState.
async function refresh(): Promise<SessionState> {
  const tenants = await fetchTenants();
  if (tenants === null) {
    return { status: "unauthenticated", user: null, activeTenantId: null, tenants: [] };
  }
  const user = await fetchCurrentUser();
  if (user === null) {
    return { status: "unauthenticated", user: null, activeTenantId: null, tenants: [] };
  }
  return {
    status: "authenticated",
    user,
    activeTenantId: tenants.activeTenantId,
    tenants: tenants.tenants,
  };
}

export function SessionProvider({ children }: { readonly children: ReactNode }): ReactNode {
  const [state, setState] = useState<SessionState>(INITIAL);

  const doRefresh = useCallback(async () => {
    const next = await refresh();
    setState(next);
  }, []);

  useEffect(() => {
    void doRefresh();
  }, [doRefresh]);

  const login = useCallback<SessionApi["login"]>(
    async (req) => {
      const res = await loginApi(req);
      if (!res.ok) return { ok: false, error: res.error };
      await doRefresh();
      return { ok: true };
    },
    [doRefresh],
  );

  const logout = useCallback<SessionApi["logout"]>(async () => {
    await logoutApi();
    setState({ status: "unauthenticated", user: null, activeTenantId: null, tenants: [] });
    // Hard-Reload: React-Tree, dispatcher-live-Caches, EventSource —
    // alles fliegt auf Null. Nach Logout ist das der billigste Weg zu
    // sauberer Ausgangslage, ohne dass wir jeden einzelnen Consumer
    // per Context-Bust invalidieren müssen.
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  }, []);

  const switchTenant = useCallback<SessionApi["switchTenant"]>(async (tenantId) => {
    await switchTenantApi(tenantId);
    // Tenant-Wechsel rotiert JWT + Cookies. React-Tree enthält
    // tenant-gebundene Caches (Queries, Live-Events) — simpler
    // Reload ist konsistent mit dem Logout-Pfad und vermeidet
    // halbe State-Übergänge.
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  }, []);

  const api: SessionApi = { ...state, login, logout, switchTenant };
  return <SessionContext.Provider value={api}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionApi {
  const ctx = useContext(SessionContext);
  if (ctx === undefined) {
    throw new Error("useSession must be used inside <SessionProvider>");
  }
  return ctx;
}
