// @runtime client
// Redirect targets for external login pages. `next` travels through the query
// string, so anything read back from it is untrusted: only same-origin
// root-relative paths pass (no "//host", no "/\host", no scheme).

export const NEXT_QUERY_PARAM = "next";

function hasControlOrWhitespace(candidate: string): boolean {
  for (let i = 0; i < candidate.length; i++) {
    const code = candidate.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

// The URL parse is a backstop: browsers strip tabs/newlines, so "/\t/evil.com"
// would otherwise normalize to "//evil.com" past the leading-slash check.
export function isSafeNextPath(candidate: unknown): candidate is string {
  if (typeof candidate !== "string" || !candidate.startsWith("/")) return false;
  if (candidate[1] === "/" || candidate.includes("\\")) return false;
  if (hasControlOrWhitespace(candidate)) return false;
  try {
    const parsed = new URL(candidate, "https://next.invalid");
    return parsed.origin === "https://next.invalid" && !parsed.pathname.startsWith("//");
  } catch {
    return false;
  }
}

export function readNextFromSearch(search: string): string | null {
  const candidate = new URLSearchParams(search).get(NEXT_QUERY_PARAM);
  return isSafeNextPath(candidate) ? candidate : null;
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
