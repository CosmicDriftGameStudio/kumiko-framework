import type { Context } from "hono";
import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { buildSessionRoles } from "../engine/membership-roles.ts";
import { createSystemUser } from "../engine/system-user.ts";
import type { SessionUser, TenantId } from "../engine/types/index.ts";
import type { Dispatcher } from "../pipeline/dispatcher.ts";
import { parseRoles } from "../utils/serialization.ts";
import type { PendingMfaStep, PublicAuthErrorStatus } from "./auth-routes-shared.ts";
import { isUnknownHandlerError, pendingMfaStepResponse } from "./auth-routes-shared.ts";
import type { AuthRoutesConfig, SessionMetadata } from "./auth-routes-types.ts";
import type { ClientIpResolver } from "./client-ip.ts";
import { clientIpSourceFromHonoContext, createClientIpResolver } from "./client-ip.ts";
import type { JwtHelper } from "./jwt.ts";
import type { PostAuthLandingArgs } from "./post-auth-landing.ts";
import { resolvePostAuthLandingPath } from "./post-auth-landing.ts";
import type { ResolvedSessionCookies } from "./session-cookies.ts";
import {
  AUTH_COOKIE_BASE,
  CSRF_COOKIE_BASE,
  expireLegacySessionCookieVariants,
  getSessionCookies,
  resolveSessionCookies,
} from "./session-cookies.ts";
import { generateToken } from "./tokens.ts";

// Double-entry cookie write used at login and switch-tenant. The auth cookie is
// the HttpOnly carrier of the JWT; the csrf cookie is the JS-readable token the
// web client echoes in X-CSRF-Token on every state-changing request. Both
// cookies share lifetime and SameSite so a stale auth-cookie can't outlive
// its csrf partner (or vice versa) and leave the client in a half-logged-in
// state that would trip the csrf-middleware on every retry.
function setAuthCookies(
  c: Context,
  opts: {
    cookies: ResolvedSessionCookies;
    token: string;
    csrfToken: string;
    sameSite: "lax" | "strict";
    domain?: string | undefined;
    retiredDomains: readonly string[];
    // Cookie lifetime must track the JWT's exp claim — both are issued
    // together, both reference the same session. Callers pass jwt.ttlSeconds
    // so the two never drift apart.
    ttlSeconds: number;
  },
): void {
  const { secure, names } = opts.cookies;
  const sameSite = opts.sameSite === "strict" ? "Strict" : "Lax";
  const common = {
    secure,
    sameSite,
    path: "/",
    maxAge: opts.ttlSeconds,
    ...(opts.domain !== undefined && { domain: opts.domain }),
  } as const;

  // With a Domain, expire the host-only variant first (as clearSessionCookies
  // does): after a deploy that sets cookieDomain, the old host-only cookie
  // would coexist with the new Domain cookie (RFC 6265 treats name+domain as
  // distinct) and the server could bind to the stale host-only token. With
  // __Host- names the unprefixed host-only cookie is a leftover from before
  // the prefix and is expired too (and vice versa, see
  // expireLegacySessionCookieVariants).
  if (opts.domain !== undefined) {
    deleteCookie(c, AUTH_COOKIE_BASE, { path: "/" });
    deleteCookie(c, CSRF_COOKIE_BASE, { path: "/" });
  }
  expireLegacySessionCookieVariants(c, opts.cookies);
  // Must precede the setCookie calls: browsers apply Set-Cookie in order and
  // a retired domain equal to the new one is rejected at config time.
  // Retired domains only ever carried unprefixed names (a __Host- cookie has no
  // Domain), and a __Host- delete with a Domain would be ignored.
  for (const retiredDomain of opts.retiredDomains) {
    deleteCookie(c, AUTH_COOKIE_BASE, { path: "/", domain: retiredDomain });
    deleteCookie(c, CSRF_COOKIE_BASE, { path: "/", domain: retiredDomain });
  }

  setCookie(c, names.auth, opts.token, { ...common, httpOnly: true });
  // Intentionally NOT HttpOnly — the web client has to read this from
  // document.cookie to include it in the X-CSRF-Token request header.
  setCookie(c, names.csrf, opts.csrfToken, { ...common, httpOnly: false });
}

const INVALID_COOKIE_DOMAIN_CHARS = /[;,\s]/;

function normalizeCookieDomain(domain: string): string {
  return domain.replace(/^\./, "").toLowerCase();
}

// A malformed entry would corrupt the Set-Cookie header; an entry equal to the
// current cookieDomain would make login delete the cookie it just sets.
function assertRetiredCookieDomains(
  retiredCookieDomains: readonly string[] | undefined,
  cookieDomain: string | undefined,
): void {
  const current = cookieDomain === undefined ? undefined : normalizeCookieDomain(cookieDomain);
  for (const entry of retiredCookieDomains ?? []) {
    if (entry === "" || normalizeCookieDomain(entry) === "") {
      throw new Error("createAuthRoutes: retiredCookieDomains must not contain an empty entry");
    }
    if (INVALID_COOKIE_DOMAIN_CHARS.test(entry)) {
      throw new Error(
        `createAuthRoutes: retiredCookieDomains entry "${entry}" contains an invalid character (;, comma or whitespace)`,
      );
    }
    if (normalizeCookieDomain(entry) === current) {
      throw new Error(
        `createAuthRoutes: retiredCookieDomains entry "${entry}" equals cookieDomain; login would delete its own cookie`,
      );
    }
  }
}

// Extract `ip` and `user-agent` for the sessionCreator. Client-IP resolution
// (trustedProxyHops-aware) is the shared resolveClientIp (see client-ip.ts)
// — createAuthRoutes builds one resolver instance below and
// closes over it here and in getClientIp.
function requestMeta(c: Context, resolver: ClientIpResolver): SessionMetadata {
  const ip = resolver.resolve(clientIpSourceFromHonoContext(c));
  const userAgent = c.req.header("user-agent") ?? "unknown";
  return { ip, userAgent };
}

export type AuthRouteContext = {
  readonly api: Hono;
  readonly dispatcher: Dispatcher;
  readonly jwt: JwtHelper;
  readonly config: AuthRoutesConfig;
  readonly cookieSameSite: "lax" | "strict";
  readonly cookieDomain: string | undefined;
  readonly sessionCookies: ResolvedSessionCookies;
  readonly retiredCookieDomains: readonly string[];
  readonly clientIpResolver: ClientIpResolver;
  readonly getClientIp: (c: Context) => string;
  readonly switchTenantMfaGate: (
    c: Context,
    user: SessionUser,
    targetTenantId: TenantId,
  ) => Promise<
    { readonly response: Response } | { readonly clearedRoles: readonly string[] } | undefined
  >;
  readonly resolveSwitchTenantRoles: (
    user: SessionUser,
    membership: { readonly roles: readonly string[] },
  ) => Promise<readonly string[]>;
  readonly mintSessionAndRespond: (c: Context, session: SessionUser) => Promise<string>;
  readonly landingPathFragment: (args: PostAuthLandingArgs) => { readonly landingPath?: string };
};

export function createAuthRouteContext(
  dispatcher: Dispatcher,
  jwt: JwtHelper,
  config: AuthRoutesConfig,
): AuthRouteContext {
  const api = new Hono();
  // Default to "lax": CSRF control comes from the double-submit token, and
  // "lax" keeps email deep-links (invite, magic-link, notification click)
  // working. High-security apps can opt into "strict" — see AuthRoutesConfig.
  const cookieSameSite = config.cookieSameSite ?? "lax";
  const cookieDomain = config.cookieDomain;
  const sessionCookies = resolveSessionCookies({
    secureCookies: config.secureCookies,
    cookieDomain,
    retiredCookieDomains: config.retiredCookieDomains,
  });
  assertRetiredCookieDomains(config.retiredCookieDomains, cookieDomain);
  if (config.mfaVerifyHandler && !config.switchTenantMfaGateHandler) {
    throw new Error(
      "createAuthRoutes: mfaVerifyHandler is set but switchTenantMfaGateHandler is not; " +
        "POST /auth/switch-tenant would mint admin sessions without the second factor",
    );
  }
  const retiredCookieDomains = config.retiredCookieDomains ?? [];
  // Single hop-count-aware IP getter for every rate-limit call site below —
  // see AuthRoutesConfig.trustedProxyHops and client-ip.ts's resolveClientIp
  // doc comment. createClientIpResolver fails loud on a non-finite/negative
  // value rather than letting it silently collapse every request into the
  // shared "unknown" bucket.
  const clientIpResolver =
    config.resolver ?? createClientIpResolver(config.trustedProxyHops ?? 0, "createAuthRoutes");
  const getClientIp = (c: Context): string =>
    clientIpResolver.resolve(clientIpSourceFromHonoContext(c));

  // undefined = no gate wired (setup without MFA). "clearedRoles" are the roles the gate decided on,
  // so the minted session cannot differ from what the gate checked.
  async function switchTenantMfaGate(
    c: Context,
    user: SessionUser,
    targetTenantId: TenantId,
  ): Promise<
    { readonly response: Response } | { readonly clearedRoles: readonly string[] } | undefined
  > {
    if (!config.switchTenantMfaGateHandler) return undefined;
    const gate = await dispatcher.write(
      config.switchTenantMfaGateHandler,
      { userId: user.id, tenantId: targetTenantId },
      createSystemUser(user.tenantId),
    );
    if (!gate.isSuccess) {
      const status = gate.error.httpStatus as PublicAuthErrorStatus; // @cast-boundary engine-payload
      return { response: c.json({ isSuccess: false, error: gate.error }, status) };
    }
    // @cast-boundary engine-payload — the gate handler's three-shape result
    const gateData = gate.data as
      | { kind: "mfa-gate-clear"; roles: readonly string[] }
      | PendingMfaStep;
    if (gateData.kind === "mfa-gate-clear") return { clearedRoles: gateData.roles };
    return { response: pendingMfaStepResponse(c, gateData) };
  }

  // Global roles (SystemAdmin etc.) come from the user feature when userQuery is wired, so they survive
  // the tenant switch. buildSessionRoles calls stripForbiddenMembershipRoles on the membership side only — a backstop
  // for a role a projection rebuild resurrected past command-time validation (engine/membership-roles).
  async function resolveSwitchTenantRoles(
    user: SessionUser,
    membership: { readonly roles: readonly string[] },
  ): Promise<readonly string[]> {
    let globalRoles: readonly string[] = [];
    if (config.userQuery) {
      try {
        // @cast-boundary engine-payload — dispatcher.query returns unknown.
        // Per the AuthUserRow contract, userQuery returns a row with a roles column.
        const userRow = (await dispatcher.query(
          config.userQuery,
          { id: user.id },
          createSystemUser(user.tenantId),
        )) as { roles?: unknown } | null;
        // roles is jsonb string[] (multiSelect); parseRoles also accepts legacy
        // JSON-encoded text from pre-0.217.0 rows.
        globalRoles = parseRoles(userRow?.roles ?? null);
      } catch (e) {
        // Non-fatal: when global roles cannot be resolved the switch continues with tenant roles
        // only. A server error carrying just the cause would hurt the UX more than a switch without
        // SystemAdmin, which the user notices and reports.
        if (!isUnknownHandlerError(e)) throw e;
      }
    }

    return buildSessionRoles(globalRoles, membership.roles);
  }

  // Shared tail of every route that ends a request logged-in: create the
  // session record (if wired), sign the JWT, set the auth+csrf cookies. Was
  // duplicated 5x (login/signup-confirm/invite-accept-with-login/invite-
  // signup-complete/switch-tenant) — extracted so a 6th caller (mfa-verify)
  // doesn't grow it to 6.
  async function mintSessionAndRespond(c: Context, session: SessionUser): Promise<string> {
    let sessionForJwt = session;
    if (config.sessionCreator) {
      const sid = await config.sessionCreator(session, requestMeta(c, clientIpResolver));
      sessionForJwt = { ...session, sid };
    }
    const token = await jwt.sign(sessionForJwt);
    const csrfToken = generateToken();
    setAuthCookies(c, {
      cookies: getSessionCookies(c, sessionCookies),
      token,
      csrfToken,
      sameSite: cookieSameSite,
      domain: cookieDomain,
      retiredDomains: retiredCookieDomains,
      ttlSeconds: jwt.ttlSeconds,
    });
    return token;
  }

  // Spreadable landingPath fragment for the 7 auth-response call sites below
  // — absent (not `landingPath: undefined`) when unwired/invalid/throwing.
  function landingPathFragment(args: PostAuthLandingArgs): { readonly landingPath?: string } {
    const landingPath = resolvePostAuthLandingPath(config.postAuthLanding, args);
    return landingPath === undefined ? {} : { landingPath };
  }

  return {
    api,
    dispatcher,
    jwt,
    config,
    cookieSameSite,
    cookieDomain,
    sessionCookies,
    retiredCookieDomains,
    clientIpResolver,
    getClientIp,
    switchTenantMfaGate,
    resolveSwitchTenantRoles,
    mintSessionAndRespond,
    landingPathFragment,
  };
}
