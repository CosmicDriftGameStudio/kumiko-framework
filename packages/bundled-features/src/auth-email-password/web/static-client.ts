// DOM-free request core for the static clients (plain Astro scripts): fetch plus pure logic only.
// It must not import the renderer, React or anything that touches `window` at import time.

import {
  CSRF_COOKIE_BASE,
  sessionCookieNameCandidates,
} from "@cosmicdrift/kumiko-types/session-cookies";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import {
  failureFromErrorField,
  isRecord,
  type KnownLoginFailureReason,
  parseRetryAfterSeconds,
} from "./login-failure.ts";

export const STATIC_NETWORK_REASON = "network";
export const STATIC_RATE_LIMITED_REASON = "rate_limited" satisfies KnownLoginFailureReason;
export const STATIC_UNKNOWN_REASON = "unknown";
export const STATIC_UNAUTHENTICATED_REASON = "unauthenticated";
// A mail client that cuts the link short sends a token below the schema's minimum length; pages
// show that as the invalid-link state, not as a generic failure.
export const STATIC_MALFORMED_TOKEN_REASON = "malformed_token";

export type StaticFailure = {
  readonly kind: "failure";
  readonly reason: KnownLoginFailureReason | (string & {});
  readonly message?: string;
  readonly retryAfterSeconds?: number;
};

export type StaticSuccess<TData> = { readonly kind: "success"; readonly data: TData };

export type StaticResult<TData> = StaticSuccess<TData> | StaticFailure;

export type StaticRequestOptions = {
  /** Sent as `X-Locale`, which picks the language of mails the request triggers. */
  readonly locale?: string;
};

const CSRF_HEADER_NAME = "X-CSRF-Token";
const LOCALE_HEADER_NAME = "X-Locale";
const WRITE_PATH = "/api/write";
const QUERY_PATH = "/api/query";

export function staticFailure(
  reason: string,
  extras: { readonly message?: string; readonly retryAfterSeconds?: number } = {},
): StaticFailure {
  return {
    kind: "failure",
    reason,
    ...(extras.message !== undefined && { message: extras.message }),
    ...(extras.retryAfterSeconds !== undefined && { retryAfterSeconds: extras.retryAfterSeconds }),
  };
}

export function staticSuccess<TData>(data: TData): StaticSuccess<TData> {
  return { kind: "success", data };
}

function readDocumentCookie(): string {
  const cookie = propertyOf(propertyOf(globalThis, "document"), "cookie");
  return typeof cookie === "string" ? cookie : "";
}

// A malformed escape in a foreign cookie must not break the request; it just carries no CSRF header.
function decodeURIComponentOrNull(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

// Anonymous visitors have no CSRF cookie and send no header; a visitor who is signed in on the
// same origin (invite acceptance) echoes it like the SPA does.
export function csrfHeaderFromCookie(cookieSource: string): Record<string, string> {
  const valuesByName = new Map<string, string>();
  for (const pair of cookieSource.split(/;\s*/)) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const name = pair.slice(0, eq);
    if (!valuesByName.has(name)) valuesByName.set(name, pair.slice(eq + 1));
  }
  for (const name of sessionCookieNameCandidates(CSRF_COOKIE_BASE)) {
    const value = valuesByName.get(name);
    if (value !== undefined && value.length > 0) {
      const decoded = decodeURIComponentOrNull(value);
      if (decoded !== null) return { [CSRF_HEADER_NAME]: decoded };
    }
  }
  return {};
}

function failsOnlyOnToken(error: unknown): boolean {
  if (!isRecord(error) || error["code"] !== "validation_error") return false;
  const details = error["details"];
  const fields = isRecord(details) ? details["fields"] : undefined;
  return (
    Array.isArray(fields) &&
    fields.length > 0 &&
    fields.every((field) => isRecord(field) && field["path"] === "token")
  );
}

function failureFromBody(body: Record<string, unknown>): StaticFailure {
  const error = body["error"];
  if (failsOnlyOnToken(error)) return staticFailure(STATIC_MALFORMED_TOKEN_REASON);
  const { reason, message, retryAfterSeconds } = failureFromErrorField(
    error,
    STATIC_UNKNOWN_REASON,
  );
  return staticFailure(reason, { message, retryAfterSeconds });
}

// Mirrors the 401 members of `MiddlewareRejectCode` in framework/src/api/auth-middleware.ts
// (not exported there, and the server must not be imported into browser code).
const SIGNED_OUT_REASONS: ReadonlySet<string> = new Set([
  STATIC_UNAUTHENTICATED_REASON,
  "missing_token",
  "invalid_token",
  "session_invalid",
]);

/** True when the server says there is no usable session; wrong credentials are not signed-out. */
export function isSignedOutFailure(result: StaticResult<unknown>): boolean {
  return result.kind === "failure" && SIGNED_OUT_REASONS.has(result.reason);
}

async function readJsonRecord(res: Response): Promise<Record<string, unknown>> {
  const parsed: unknown = await res.json().catch(() => ({}));
  return isRecord(parsed) ? parsed : {};
}

export async function postJson(
  path: string,
  payload: Record<string, unknown>,
  options: StaticRequestOptions = {},
): Promise<StaticResult<Record<string, unknown>>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...(options.locale !== undefined && { [LOCALE_HEADER_NAME]: options.locale }),
        ...csrfHeaderFromCookie(readDocumentCookie()),
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return staticFailure(STATIC_NETWORK_REASON);
  }
  const body = await readJsonRecord(res);
  if (res.status === 429) {
    const fromBody = failureFromBody(body).retryAfterSeconds;
    const retryAfterSeconds = parseRetryAfterSeconds(res.headers.get("Retry-After")) ?? fromBody;
    return staticFailure(STATIC_RATE_LIMITED_REASON, { retryAfterSeconds });
  }
  if (!res.ok || body["isSuccess"] === false) {
    const failure = failureFromBody(body);
    // Session-less calls to session-only routes may answer 401 without a usable code.
    return res.status === 401 && failure.reason === STATIC_UNKNOWN_REASON
      ? staticFailure(STATIC_UNAUTHENTICATED_REASON, {
          message: failure.message,
          retryAfterSeconds: failure.retryAfterSeconds,
        })
      : failure;
  }
  return staticSuccess(body);
}

export async function dispatchWrite(
  type: string,
  payload: Record<string, unknown>,
  options?: StaticRequestOptions,
): Promise<StaticResult<unknown>> {
  const result = await postJson(WRITE_PATH, { type, payload }, options);
  return result.kind === "success" ? staticSuccess(result.data["data"]) : result;
}

export async function dispatchQuery(
  type: string,
  payload: Record<string, unknown>,
  options?: StaticRequestOptions,
): Promise<StaticResult<unknown>> {
  const result = await postJson(QUERY_PATH, { type, payload }, options);
  return result.kind === "success" ? staticSuccess(result.data["data"]) : result;
}

export type UrlTokenSource = "query" | "fragment";

export const URL_TOKEN_PARAM = "token";

function paramsOf(url: URL, source: UrlTokenSource): URLSearchParams {
  return source === "query" ? url.searchParams : new URLSearchParams(url.hash.replace(/^#/, ""));
}

export function readUrlToken(href: string, source: UrlTokenSource): string {
  return paramsOf(new URL(href), source).get(URL_TOKEN_PARAM) ?? "";
}

// Single-use tokens must not linger in history or the Referer once the page has read them.
export function hrefWithoutUrlToken(href: string, source: UrlTokenSource): string {
  const url = new URL(href);
  const params = paramsOf(url, source);
  if (!params.has(URL_TOKEN_PARAM)) return href;
  params.delete(URL_TOKEN_PARAM);
  if (source === "query") {
    url.search = params.toString();
  } else {
    const rest = params.toString();
    url.hash = rest === "" ? "" : `#${rest}`;
  }
  return url.toString();
}

/** Reads the token from the current page and removes it from the address bar. Browser only. */
export function takeUrlToken(source: UrlTokenSource): string {
  const href = window.location.href;
  const token = readUrlToken(href, source);
  const scrubbed = hrefWithoutUrlToken(href, source);
  if (scrubbed !== href) window.history.replaceState(null, "", scrubbed);
  return token;
}
