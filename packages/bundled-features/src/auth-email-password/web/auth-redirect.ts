// Redirect targets for external login pages. `next` travels through the query
// string, so anything read back from it is untrusted: only same-origin
// root-relative paths pass (no "//host", no "/\host", no scheme).

import { appendReturnTo, NEXT_QUERY_PARAM } from "./login-url.ts";
import { isSafeReturnPath, readReturnToFromSearch } from "./return-path.ts";

export { appendReturnTo, NEXT_QUERY_PARAM };

export const isSafeNextPath = isSafeReturnPath;

export function readNextFromSearch(search: string): string | null {
  const candidate = new URLSearchParams(search).get(NEXT_QUERY_PARAM);
  return isSafeNextPath(candidate) ? candidate : null;
}

// The returnTo a mail link or sibling auth page carried in this page's own URL; null on native, where there is no window.
export function readReturnToFromWindow(): string | null {
  return typeof window === "undefined" ? null : readReturnToFromSearch(window.location.search);
}

// The safe `next` of this page's URL; null on native, where there is no window.
export function readNextFromWindow(): string | null {
  return typeof window === "undefined" ? null : readNextFromSearch(window.location.search);
}

// loginUrl/postLogoutUrl come from app code (trusted), but a typo like
// "javascript:" must fail at startup instead of becoming a navigation target.
export function assertNavigableUrl(url: string, optionName: string): void {
  // skip: a safe root-relative path needs no protocol check
  if (url.startsWith("/") && isSafeNextPath(url)) return;
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    throw new Error(`${optionName} must be a root-relative path or an http(s) URL, got "${url}"`);
  }
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error(`${optionName} must be a root-relative path or an http(s) URL, got "${url}"`);
  }
}

export function buildLoginRedirectUrl(
  loginUrl: string,
  returnPath: string,
  currentOrigin: string,
): string {
  const target = new URL(loginUrl, currentOrigin);
  if (isSafeNextPath(returnPath)) target.searchParams.set(NEXT_QUERY_PARAM, returnPath);
  const isSameOrigin = target.origin === currentOrigin;
  return isSameOrigin ? `${target.pathname}${target.search}${target.hash}` : target.href;
}

// Login screens call this after a successful login. `next` is re-validated
// here because it is read from the URL, i.e. attacker-controlled. Returns
// true when it navigated.
export function followNextAfterLogin(
  location: Pick<Location, "search" | "pathname" | "replace"> = window.location,
): boolean {
  const next = readNextFromSearch(location.search);
  if (next === null) return false;
  // Following a next that points at the login page itself would reload it forever.
  if (new URL(next, "https://next.invalid").pathname === location.pathname) return false;
  location.replace(next);
  return true;
}

// An explicit `next` (the page the user was sent away from) beats the server's
// landingPath (auth.postAuthLanding); without either the caller keeps its own
// client-side routing. landingPath is re-validated like `next`, so a
// misconfigured resolver cannot turn the login into an open redirect.
export function followNextOrLandingAfterLogin(
  landingPath: string | undefined,
  location: Pick<Location, "search" | "pathname" | "replace"> = window.location,
): boolean {
  if (followNextAfterLogin(location)) return true;
  if (landingPath === undefined || !isSafeNextPath(landingPath)) return false;
  if (new URL(landingPath, "https://next.invalid").pathname === location.pathname) return false;
  location.replace(landingPath);
  return true;
}
