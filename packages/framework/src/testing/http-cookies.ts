// Shared Set-Cookie parser for tests. Cookie-auth tests (auth-middleware,
// csrf-middleware, auth-routes, auth.integration) all need the same
// primitive: "given a Response, give me the cookies the server tried to
// set". Before this helper each test file rolled its own — three near-
// duplicates that drift the moment one adds Domain/Partitioned/Priority
// parsing the others don't.
//
// The helper returns both the parsed value AND the raw string so callers
// can assert on attributes like SameSite, HttpOnly, Max-Age without a
// second parse step.

export type ParsedSetCookie = {
  readonly value: string;
  readonly raw: string;
};

// Pull every Set-Cookie the response carries. Prefers the standard
// `Headers.getSetCookie()` (Node 20+, Bun, modern undici/whatwg-fetch);
// falls back to the single-header-value for environments that don't
// expose it. The fallback path only sees the FIRST cookie if multiple
// were set in one response — a limitation of RFC 7230 headers — which
// is acceptable here because tests that set multiple cookies run on a
// runtime that supports getSetCookie.
export function getSetCookies(res: Response): Map<string, ParsedSetCookie> {
  const getter = (res.headers as { getSetCookie?: () => string[] }).getSetCookie;
  const raws = getter ? getter.call(res.headers) : [res.headers.get("set-cookie") ?? ""];
  const out = new Map<string, ParsedSetCookie>();
  for (const raw of raws) {
    if (!raw) continue;
    const first = raw.split(";")[0];
    if (!first) continue;
    const eq = first.indexOf("=");
    if (eq === -1) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    out.set(name, { value, raw });
  }
  return out;
}

// Convenience for the common case: "give me the value of cookie X".
// Returns undefined when the cookie isn't set — no throw, so negative
// assertions read cleanly (`expect(cookies.get("foo")).toBeUndefined()`).
export function getSetCookieValue(res: Response, name: string): string | undefined {
  return getSetCookies(res).get(name)?.value;
}

// Raw Set-Cookie header for attribute assertions
// (`expect(raw).toMatch(/SameSite=Lax/)`). Returns undefined when missing.
export function getSetCookieRaw(res: Response, name: string): string | undefined {
  return getSetCookies(res).get(name)?.raw;
}
