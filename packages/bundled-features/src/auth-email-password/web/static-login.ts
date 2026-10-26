// DOM-free login for static sites (plain Astro scripts): fetch plus pure string logic only. It
// must not import auth-client.ts or auth-gate.tsx, which pull in the renderer, React and window
// access at import time. Only the pure modules below are allowed.

import {
  failureFromErrorField,
  isRecord,
  type KnownLoginFailureReason,
  parseRetryAfterSeconds,
} from "./login-failure.ts";
import { appendReturnTo, type LoginUrlBuilder, NEXT_QUERY_PARAM } from "./login-url.ts";
import { isSafeReturnPath } from "./return-path.ts";

export { NEXT_QUERY_PARAM };

export const STATIC_LOGIN_FAILED_REASON = "login_failed";
export const STATIC_MFA_VERIFY_FAILED_REASON = "mfa_verify_failed";
export const STATIC_NETWORK_FAILURE_REASON = "network";
export const STATIC_RATE_LIMITED_REASON = "rate_limited" satisfies KnownLoginFailureReason;
export const STATIC_MFA_SETUP_REQUIRED_REASON =
  "mfa_setup_required" satisfies KnownLoginFailureReason;

export type StaticAuthResult =
  | { readonly kind: "success"; readonly landingPath?: string }
  | { readonly kind: "mfa-challenge"; readonly challengeToken: string }
  | { readonly kind: "mfa-setup-required" }
  | {
      readonly kind: "failure";
      readonly reason: KnownLoginFailureReason | (string & {});
      readonly retryAfterSeconds?: number;
    };

function failure(
  reason: string,
  retryAfterSeconds?: number,
): Extract<StaticAuthResult, { kind: "failure" }> {
  return {
    kind: "failure",
    reason,
    ...(retryAfterSeconds !== undefined && { retryAfterSeconds }),
  };
}

function interpretBody(body: Record<string, unknown>, fallbackReason: string): StaticAuthResult {
  if (body["isSuccess"] === true) {
    const challengeToken = body["challengeToken"];
    if (body["mfaRequired"] === true && typeof challengeToken === "string") {
      return { kind: "mfa-challenge", challengeToken };
    }
    if (body["mfaSetupRequired"] === true) return { kind: "mfa-setup-required" };
    if (body["token"] !== undefined && body["user"] !== undefined) {
      const landingPath = body["landingPath"];
      return typeof landingPath === "string"
        ? { kind: "success", landingPath }
        : { kind: "success" };
    }
  }
  const { reason, retryAfterSeconds } = failureFromErrorField(body["error"], fallbackReason);
  if (reason === STATIC_MFA_SETUP_REQUIRED_REASON) return { kind: "mfa-setup-required" };
  return failure(reason, retryAfterSeconds);
}

// Same request shape as auth-client's login() and mfa-client's verifyMfaChallenge(): no CSRF
// header because no session exists yet.
async function postAuth(
  path: string,
  payload: Record<string, string>,
  fallbackReason: string,
): Promise<StaticAuthResult> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    return failure(STATIC_NETWORK_FAILURE_REASON);
  }
  if (res.status === 429) {
    return failure(
      STATIC_RATE_LIMITED_REASON,
      parseRetryAfterSeconds(res.headers.get("Retry-After")),
    );
  }
  const parsed: unknown = await res.json().catch(() => ({}));
  return interpretBody(isRecord(parsed) ? parsed : {}, fallbackReason);
}

export function loginWithPassword(email: string, password: string): Promise<StaticAuthResult> {
  return postAuth("/api/auth/login", { email, password }, STATIC_LOGIN_FAILED_REASON);
}

export function verifyMfaCode(challengeToken: string, code: string): Promise<StaticAuthResult> {
  return postAuth(
    "/api/auth/mfa/verify",
    { challengeToken, code },
    STATIC_MFA_VERIFY_FAILED_REASON,
  );
}

export type IsAppPath = (pathname: string) => boolean;

function pathnameOf(pathAndQuery: string): string {
  const end = pathAndQuery.search(/[?#]/);
  return end === -1 ? pathAndQuery : pathAndQuery.slice(0, end);
}

// `next` is read from a URL, so beyond the shared same-origin check it must also point into the
// app; string logic only, because React Native's URL getters throw.
export function appReturnPath(candidate: unknown, isAppPath: IsAppPath): string | null {
  if (!isSafeReturnPath(candidate)) return null;
  return isAppPath(pathnameOf(candidate)) ? candidate : null;
}

function readAppNext(search: string, isAppPath: IsAppPath): string | null {
  return appReturnPath(new URLSearchParams(search).get(NEXT_QUERY_PARAM), isAppPath);
}

export function postLoginPath(options: {
  readonly search: string;
  readonly landingPath?: string | undefined;
  readonly isAppPath: IsAppPath;
  readonly fallbackPath: string;
}): string {
  const next = readAppNext(options.search, options.isAppPath);
  if (next !== null) return next;
  if (isSafeReturnPath(options.landingPath)) return options.landingPath;
  return options.fallbackPath;
}

export function forgotPasswordHref(
  forgotPasswordPath: string,
  search: string,
  isAppPath: IsAppPath,
): string {
  return appendReturnTo(forgotPasswordPath, readAppNext(search, isAppPath));
}

export type MarketingLoginPaths = {
  readonly default: string;
  /** Lowercase locale prefix ("de") to its login path. */
  readonly byLocale?: Readonly<Record<string, string>>;
};

function trimTrailingSlashes(pathname: string): string {
  return pathname.replace(/\/+$/, "");
}

export function isMarketingLoginPath(pathname: string, localePaths: MarketingLoginPaths): boolean {
  const target = trimTrailingSlashes(pathname);
  const loginPaths = [localePaths.default, ...Object.values(localePaths.byLocale ?? {})];
  return loginPaths.some((loginPath) => trimTrailingSlashes(loginPath) === target);
}

function loginPathFor(locale: string, localePaths: MarketingLoginPaths): string {
  const prefix = (locale.toLowerCase().split(/[-_]/)[0] ?? "").trim();
  const byLocale = localePaths.byLocale;
  if (byLocale !== undefined && Object.hasOwn(byLocale, prefix)) {
    return byLocale[prefix] ?? localePaths.default;
  }
  return localePaths.default;
}

// Marketing site to app login: keeps the user's place as `next` when it is an app path, and never
// bounces from a login page back to itself.
export function marketingLoginUrl(options: {
  readonly localePaths: MarketingLoginPaths;
  readonly isAppPath: IsAppPath;
}): LoginUrlBuilder {
  const { localePaths, isAppPath } = options;
  return (locale, returnPath) => {
    const hashAt = returnPath.indexOf("#");
    const pathAndQuery = hashAt === -1 ? returnPath : returnPath.slice(0, hashAt);
    const pathname = pathnameOf(pathAndQuery);
    if (isMarketingLoginPath(pathname, localePaths)) return pathname;
    const loginPath = loginPathFor(locale, localePaths);
    const next = appReturnPath(pathAndQuery, isAppPath);
    return next === null
      ? loginPath
      : `${loginPath}?${NEXT_QUERY_PARAM}=${encodeURIComponent(next)}`;
  };
}
