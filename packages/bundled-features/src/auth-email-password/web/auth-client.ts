// @runtime client
// Browser-Seite der Auth-Routes. Dünne fetch-Wrapper um /api/auth/*
// mit Cookie-Transport: JWT lebt im HttpOnly kumiko_auth-Cookie,
// Double-Submit-CSRF-Token im JS-lesbaren kumiko_csrf-Cookie. Alle
// state-changing Requests echo'n den CSRF-Token via X-CSRF-Token —
// der Server rejected sonst mit csrf_token_missing.
//
// Die dispatcher-live nutzt denselben readCsrfToken-Helper; wir
// reuse'n ihn hier, damit die Konstanten (Cookie-Name, Header-Name)
// nicht divergieren.

import { CSRF_HEADER_NAME, readCsrfToken } from "@kumiko/dispatcher-live";

export type TenantSummary = {
  readonly tenantId: string;
  readonly roles: readonly string[];
};

export type LoginRequest = {
  readonly email: string;
  readonly password: string;
};

export type LoginResponse = {
  readonly token: string;
  readonly user: {
    readonly id: string;
    readonly tenantId: string;
    readonly roles: readonly string[];
  };
};

export type LoginFailure = {
  readonly reason: string;
  readonly message?: string;
  readonly retryAfterSeconds?: number;
};

function csrfHeader(): Record<string, string> {
  const token = readCsrfToken();
  return token !== undefined ? { [CSRF_HEADER_NAME]: token } : {};
}

// POST /api/auth/login. Erfolg → token + user; Fehler → strukturiertes
// failure-objekt mit reason (invalid_credentials, account_locked,
// no_membership, rate_limited). Das UI rendert darüber eine passende
// Fehler-Meldung; der Server setzt Cookies bei 200 automatisch.
export async function login(
  req: LoginRequest,
): Promise<{ ok: true; data: LoginResponse } | { ok: false; error: LoginFailure }> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (res.status === 429) {
    return { ok: false, error: { reason: "rate_limited" } };
  }
  // @cast-boundary engine-payload — HTTP-API contract, server-side schema-validated
  const body = (await res.json().catch(() => ({}))) as {
    isSuccess?: boolean;
    token?: string;
    user?: LoginResponse["user"];
    error?:
      | {
          code?: string;
          message?: string;
          details?: { reason?: string; retryAfterSeconds?: number };
        }
      | string;
  };
  if (body.isSuccess === true && body.token !== undefined && body.user !== undefined) {
    return { ok: true, data: { token: body.token, user: body.user } };
  }
  // Der Server schickt error entweder als string ("invalid_body") oder als
  // strukturiertes Objekt. Wir ziehen uns den sprechendsten Reason raus.
  const err = body.error;
  if (typeof err === "string") {
    return { ok: false, error: { reason: err } };
  }
  const reason = err?.details?.reason ?? err?.code ?? "login_failed";
  const retry = err?.details?.retryAfterSeconds;
  return {
    ok: false,
    error: {
      reason,
      ...(err?.message !== undefined && { message: err.message }),
      ...(retry !== undefined && { retryAfterSeconds: retry }),
    },
  };
}

// POST /api/auth/logout. Server revoked die Session (wenn sessionRevoker
// gewired ist) und clear't die Cookies. Wir triggern hinterher einen
// Navigation-Refresh, damit alle caches (React-State, query-cache) auf
// Null gehen — billigster Weg zu sauberer Ausgangslage.
export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...csrfHeader() },
  });
}

// GET /api/auth/tenants. Liefert die Memberships des aktuellen Users;
// der Server liefert 401 wenn das Cookie fehlt oder abgelaufen ist.
export async function fetchTenants(): Promise<{
  readonly tenants: readonly TenantSummary[];
  readonly activeTenantId: string;
} | null> {
  const res = await fetch("/api/auth/tenants", {
    method: "GET",
    credentials: "same-origin",
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`auth/tenants failed: ${res.status}`);
  // @cast-boundary engine-payload — HTTP-API contract, server-side schema-validated
  return (await res.json()) as {
    tenants: readonly TenantSummary[];
    activeTenantId: string;
  };
}

// POST /api/auth/switch-tenant. Mintet ein neues JWT für den Ziel-Tenant
// und rotated beide Cookies. 400 wenn already_in_tenant oder tenant_
// switch_not_available, 403 wenn not_a_member.
export async function switchTenant(tenantId: string): Promise<void> {
  const res = await fetch("/api/auth/switch-tenant", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...csrfHeader() },
    body: JSON.stringify({ tenantId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`switch-tenant failed: ${res.status} ${JSON.stringify(body)}`);
  }
}

// POST /api/query → user:query:user:me. Profil-Daten (email, displayName)
// für das UserMenu im Topbar. 401 → kein Cookie / abgelaufen, wird
// vom SessionProvider als "ausgeloggt" interpretiert.
export type CurrentUserProfile = {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly locale?: string;
};

export async function fetchCurrentUser(): Promise<CurrentUserProfile | null> {
  const res = await fetch("/api/query", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...csrfHeader() },
    body: JSON.stringify({ type: "user:query:user:me", payload: {} }),
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`user:me failed: ${res.status}`);
  // @cast-boundary engine-payload — HTTP-API contract, server-side schema-validated
  const body = (await res.json()) as {
    data?: {
      id: string;
      email: string;
      displayName: string;
      locale?: string;
    };
  };
  return body.data ?? null;
}
