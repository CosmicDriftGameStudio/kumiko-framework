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

import { CSRF_HEADER_NAME, readCsrfToken } from "@cosmicdrift/kumiko-dispatcher-live";

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

export function csrfHeader(): Record<string, string> {
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

// Gemeinsamer Failure-Type für die vier Token-Flow-Endpoints (request-
// password-reset, reset-password, request-email-verification, verify-
// email). Server collapses alle Token-Verify-Fehler (malformed / bad-
// signature / expired) auf einen einzigen Code pro Flow (anti-
// enumeration); UI mappt reason → i18n-Key. Plus rate-limit (429) wird
// als reason "rate_limited" + retryAfterSeconds durchgereicht — gleiche
// Shape wie LoginFailure damit Apps die Errors uniform mappen können.
export type AuthTokenFailure = {
  readonly reason: string;
  readonly retryAfterSeconds?: number;
};

// Backward-compat-Aliase für die alten Type-Namen — damit Code, der
// `ResetPasswordFailure` / `VerifyEmailFailure` importiert hat, ohne
// Änderung weiterläuft. Für neuen Code direkt `AuthTokenFailure` nutzen.
export type ResetPasswordFailure = AuthTokenFailure;
export type VerifyEmailFailure = AuthTokenFailure;

// 4xx/5xx → typed AuthTokenFailure parsen. 429 (Rate-Limit) hat einen
// dedizierten reason damit das UI einen Retry-Hinweis zeigen kann.
async function parseTokenFailure(res: Response): Promise<AuthTokenFailure> {
  if (res.status === 429) {
    // @cast-boundary engine-payload — server schickt details.retryAfterSeconds bei 429
    const body = (await res.json().catch(() => ({}))) as {
      error?: { details?: { retryAfterSeconds?: number } };
    };
    const retry = body.error?.details?.retryAfterSeconds;
    return { reason: "rate_limited", ...(retry !== undefined && { retryAfterSeconds: retry }) };
  }
  // @cast-boundary engine-payload — server-side schema-validated body
  const body = (await res.json().catch(() => ({}))) as {
    error?: { code?: string; details?: { reason?: string } };
  };
  const reason = body.error?.details?.reason ?? body.error?.code ?? "unknown";
  return { reason };
}

// POST /api/auth/request-password-reset. 200 silent-success: auch wenn
// die Email nicht existiert, sieht der caller `{ ok: true }` — kein
// account-enumeration. Server triggert Mail nur intern wenn user
// gefunden. 429 → typed rate-limit-Failure. 5xx → unknown-error.
export async function requestPasswordReset(
  email: string,
): Promise<{ ok: true } | { ok: false; error: AuthTokenFailure }> {
  const res = await fetch("/api/auth/request-password-reset", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...csrfHeader() },
    body: JSON.stringify({ email }),
  });
  if (res.ok) return { ok: true };
  return { ok: false, error: await parseTokenFailure(res) };
}

// POST /api/auth/reset-password. Token aus URL + neues Passwort. Auf
// 422 collapses der Server alle Token-Verify-Fehler (malformed / bad-
// signature / expired) auf den einzigen Code `invalid_reset_token` —
// anti-enumeration. Plus zod-validation-failures (newPassword < 8) als
// eigene 4xx mit code "validation_failed". UI mappt reason → i18n-Key.
export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; error: AuthTokenFailure }> {
  const res = await fetch("/api/auth/reset-password", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...csrfHeader() },
    body: JSON.stringify({ token, newPassword }),
  });
  if (res.ok) return { ok: true };
  return { ok: false, error: await parseTokenFailure(res) };
}

// POST /api/auth/request-email-verification. Same silent-success
// semantik wie request-password-reset. 429 → rate-limit-Failure.
export async function requestEmailVerification(
  email: string,
): Promise<{ ok: true } | { ok: false; error: AuthTokenFailure }> {
  const res = await fetch("/api/auth/request-email-verification", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...csrfHeader() },
    body: JSON.stringify({ email }),
  });
  if (res.ok) return { ok: true };
  return { ok: false, error: await parseTokenFailure(res) };
}

// POST /api/auth/verify-email. Auto-submitted vom VerifyEmailScreen
// nach `?token=...`-parse. Server collapses alle Verify-Failures auf
// `invalid_verification_token` (anti-enumeration, parallel zu reset).
export async function verifyEmail(
  token: string,
): Promise<{ ok: true } | { ok: false; error: AuthTokenFailure }> {
  const res = await fetch("/api/auth/verify-email", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...csrfHeader() },
    body: JSON.stringify({ token }),
  });
  if (res.ok) return { ok: true };
  return { ok: false, error: await parseTokenFailure(res) };
}

// POST /api/auth/signup-request. Always-200 (anti-enumeration; wir
// sagen nicht ob die Email schon registriert ist). Server schickt
// Activation-Mail an die Adresse — beim Klick auf den Link landet der
// User auf /signup/complete?token=… wo er sein Password setzt.
export async function requestSignup(
  email: string,
): Promise<{ ok: true } | { ok: false; error: AuthTokenFailure }> {
  const res = await fetch("/api/auth/signup-request", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...csrfHeader() },
    body: JSON.stringify({ email }),
  });
  if (res.ok) return { ok: true };
  return { ok: false, error: await parseTokenFailure(res) };
}

// POST /api/auth/signup-confirm. Token aus URL + Password. Erfolgreich:
// Cookies (kumiko_auth + kumiko_csrf) werden gesetzt — User ist sofort
// eingeloggt. Response liefert tenantKey für den Post-Signup-Redirect.
// 422 invalid_signup_token bei abgelaufenem/unbekanntem Token.
export type SignupConfirmSuccess = {
  readonly user: { readonly id: string; readonly tenantId: string; readonly roles: string[] };
  readonly tenantKey: string;
};

export async function confirmSignup(
  token: string,
  password: string,
): Promise<{ ok: true; data: SignupConfirmSuccess } | { ok: false; error: AuthTokenFailure }> {
  const res = await fetch("/api/auth/signup-confirm", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...csrfHeader() },
    body: JSON.stringify({ token, password }),
  });
  if (res.ok) {
    const body = (await res.json()) as SignupConfirmSuccess; // @cast-boundary engine-payload
    return { ok: true, data: body };
  }
  return { ok: false, error: await parseTokenFailure(res) };
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
//
// globalRoles: tenant-unabhängige user-rollen (z.B. SystemAdmin) aus
// users.roles. Im JWT schon mit tenant-membership-roles gemerged, aber
// das JWT ist HttpOnly + nicht JS-lesbar — der Client muss die globalen
// Rollen separat aus dem user-row holen damit nav-filtering greift.
export type CurrentUserProfile = {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly locale?: string;
  readonly globalRoles: readonly string[];
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
      // JSON-encoded string[] — siehe userEntity.roles. Default "[]" wenn
      // keine globalen Rollen.
      roles?: string;
    };
  };
  if (!body.data) return null;
  return {
    id: body.data.id,
    email: body.data.email,
    displayName: body.data.displayName,
    ...(body.data.locale !== undefined && { locale: body.data.locale }),
    globalRoles: parseGlobalRoles(body.data.roles),
  };
}

// Defensive parse — server-side ist die Spalte JSON-encoded string[],
// aber bei migration-drift oder corrupted-row liefern wir [] statt einen
// runtime-throw der die ganze SessionProvider-mount blockt.
function parseGlobalRoles(raw: string | undefined): readonly string[] {
  if (typeof raw !== "string" || raw.length === 0) return [];
  try {
    // @cast-boundary user-row.roles is JSON-encoded string[] per server contract
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.every((r) => typeof r === "string")) {
      return parsed;
    }
  } catch {
    // malformed JSON → behave as empty
  }
  return [];
}
