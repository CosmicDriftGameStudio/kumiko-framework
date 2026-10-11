import {
  assertAllowedTarget,
  assertHttpScheme,
  assertValidInternalPolicy,
  type EgressPolicy,
  type InternalEgressPolicy,
  type ResolvedHost,
  resolvePublicHost,
} from "./policy.js";

const MAX_INTERNAL_REDIRECTS = 5;

// Bun's fetch() accepts a `tls.servername` request option that upstream
// bun-types does not declare — see buildPinnedRequest below for why it is
// needed (TLS SNI must stay pinned to the original hostname, not the
// resolved IP we connect to).
type PinnedRequestInit = RequestInit & { tls?: { servername: string } };

// Single exported way to speak outward. The policy is named once, at bind
// time, and cannot drift from the request that follows it.
export function egress(
  policy: EgressPolicy,
): (raw: string, init?: RequestInit) => Promise<Response> {
  if (policy.kind === "internal") assertValidInternalPolicy(policy);
  return (raw, init) => runEgress(policy, raw, init);
}

async function runEgress(
  policy: EgressPolicy,
  raw: string,
  init: RequestInit | undefined,
): Promise<Response> {
  const url = new URL(raw);
  assertHttpScheme(url);

  if (policy.kind === "internal") {
    assertAllowedTarget(url, policy);
    return fetchWithAllowlistedRedirects(url, policy, init);
  }

  // external + tenant-supplied: deny private/reserved/link-local ranges,
  // pin the connect to the exact address that passed that check (closes the
  // DNS-rebinding TOCTOU, see buildPinnedRequest), and never follow a
  // redirect — a 3xx could point anywhere, including back into the denied
  // ranges above. The caller sees the 3xx response itself and, to follow it,
  // is expected to call `egress()` again with the Location header — which
  // re-runs this same resolve-and-pin check against the new host.
  const resolved = await resolvePublicHost(url);
  const pinned = buildPinnedRequest(url, resolved, init);
  const res = await fetch(pinned.url, withManualRedirect(pinned.init));
  return withOriginalUrl(res, url);
}

// fetch() reports `res.url` as the address it actually connected to — the
// pinned IP literal, not the hostname the caller asked for. Left alone, a
// caller resolving a relative Location header the normal way
// (`new URL(location, res.url)`) would resolve it against the IP instead of
// the original host, and the re-invoked egress() call would then pin and
// SNI-validate against that IP, breaking virtual hosting and TLS for
// essentially every real server. Overwriting `.url` back to the original
// request URL keeps that caller pattern working exactly as it would without
// IP pinning.
export function withOriginalUrl(res: Response, originalUrl: URL): Response {
  Object.defineProperty(res, "url", { value: originalUrl.toString(), configurable: true });
  return res;
}

// Rewrites the request to connect directly to `resolved.address` — the
// exact address `resolvePublicHost` just validated — instead of handing
// `fetch()` the original hostname and letting it resolve again. That second
// resolution is the DNS-rebinding window: fetch-by-IP removes it entirely,
// since there is no hostname left for fetch to look up. The original
// hostname is preserved in the Host header (virtual hosting) and in
// `tls.servername` (TLS SNI, and certificate validation still checks the
// real hostname — not the IP we dial).
export function buildPinnedRequest(
  url: URL,
  resolved: ResolvedHost,
  init: RequestInit | undefined,
): { url: URL; init: PinnedRequestInit } {
  const pinnedHost = resolved.family === 6 ? `[${resolved.address}]` : resolved.address;
  const pinnedUrl = new URL(url.toString());
  pinnedUrl.hostname = pinnedHost;
  if (pinnedUrl.hostname !== pinnedHost) {
    // The WHATWG URL hostname setter silently no-ops on invalid input
    // instead of throwing. If that ever happened here, the request would
    // silently fall back to the original (unpinned) hostname — reopening
    // the rebinding window this function exists to close. Fail loudly.
    throw new Error(`egress: failed to pin connection to resolved address ${resolved.address}`);
  }

  const headers = new Headers(init?.headers);
  headers.set("host", url.host);

  const pinnedInit: PinnedRequestInit = { ...init, headers };
  if (url.protocol === "https:") {
    pinnedInit.tls = { servername: url.hostname };
  }
  return { url: pinnedUrl, init: pinnedInit };
}

// Applied last, after spreading the caller's `init` — a caller cannot
// override the policy's redirect handling by passing its own `redirect`
// option. Used by both the external/tenant-supplied fetch above and the
// internal redirect loop below, so it is not part of the package's public
// barrel (not re-exported from index.ts) but is a plain named export for
// that shared use and for pinning the invariant directly in
// ./__tests__/egress.test.ts.
export function withManualRedirect(init: RequestInit | undefined): RequestInit {
  return { ...init, redirect: "manual" };
}

const ORIGIN_CHANGE_SAFE_HEADERS: ReadonlySet<string> = new Set([
  "content-type",
  "accept",
  "accept-encoding",
  "accept-language",
  "user-agent",
]);

// Allowlist, not denylist: any credential-bearing header we have not thought
// of (x-api-key, custom tokens) must not follow a redirect to another origin.
function stripToSafeHeaders(init: RequestInit | undefined): RequestInit {
  const kept = new Headers();
  for (const [name, value] of new Headers(init?.headers)) {
    if (ORIGIN_CHANGE_SAFE_HEADERS.has(name)) kept.set(name, value);
  }
  return { ...init, headers: kept };
}

// `internal` is the only kind that permits redirects (it is the only kind
// with an allowlist to re-validate them against). Each hop's Location is
// resolved, restricted to the current hop's host and checked against the
// policy before it is followed, capped at MAX_INTERNAL_REDIRECTS.
// `init` (method, body) is replayed verbatim on every hop — unlike a browser,
// this does not downgrade POST to GET on a 301/302/303. Headers are replayed
// only while the origin is unchanged; once a hop leaves the original origin
// (scheme or port differs), credential headers are dropped for the rest of the
// chain. The body is still replayed to the new origin (as fetch does on
// 307/308); use allowOrigins to forbid such hops entirely.
async function fetchWithAllowlistedRedirects(
  url: URL,
  policy: InternalEgressPolicy,
  init: RequestInit | undefined,
): Promise<Response> {
  let current = url;
  let hopInit = init;
  let strippedInit: RequestInit | undefined;
  for (let hop = 0; hop <= MAX_INTERNAL_REDIRECTS; hop++) {
    const res = await fetch(current, withManualRedirect(hopInit));
    if (res.status < 300 || res.status >= 400) return res;
    const location = res.headers.get("location");
    if (!location) return res; // 3xx without Location — nothing to follow

    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      throw new Error(
        `egress(internal): redirect Location header is not a resolvable URL: ${location}`,
      );
    }
    assertHttpScheme(next);
    // Hosts may differ in the allowlist; credentials must still not hop
    // between them.
    if (next.hostname.toLowerCase() !== current.hostname.toLowerCase()) {
      throw new Error(
        `egress(internal): redirect crosses host (${current.hostname} -> ${next.hostname}), not followed`,
      );
    }
    assertAllowedTarget(next, policy);
    if (next.origin !== url.origin) {
      strippedInit ??= stripToSafeHeaders(init);
      hopInit = strippedInit;
    }
    current = next;
  }
  throw new Error(`egress(internal): exceeded ${MAX_INTERNAL_REDIRECTS} redirects`);
}
