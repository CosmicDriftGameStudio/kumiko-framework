import { assertAllowedHost, assertHttpScheme, assertPublicHost, type EgressPolicy } from "./policy";

const MAX_INTERNAL_REDIRECTS = 5;

// Single exported way to speak outward. The policy is named once, at bind
// time, and cannot drift from the request that follows it.
export function egress(
  policy: EgressPolicy,
): (raw: string, init?: RequestInit) => Promise<Response> {
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
    assertAllowedHost(url, policy.allowHosts);
    return fetchWithAllowlistedRedirects(url, policy.allowHosts, init);
  }

  // external + tenant-supplied: deny private/reserved/link-local ranges and
  // never follow a redirect — a 3xx could point anywhere, including back
  // into the denied ranges above. The caller sees the 3xx response itself.
  await assertPublicHost(url);
  return fetch(url, withManualRedirect(init));
}

// Applied last, after spreading the caller's `init` — a caller cannot
// override the policy's redirect handling by passing its own `redirect`
// option. Used by both the direct fetch below and the internal redirect
// loop, so it is not part of the package's public barrel (not re-exported
// from index.ts) but is a plain named export for that shared use and for
// pinning the invariant directly in ./__tests__/egress.test.ts.
export function withManualRedirect(init: RequestInit | undefined): RequestInit {
  return { ...init, redirect: "manual" };
}

// `internal` is the only kind that permits redirects (it is the only kind
// with a host allowlist to re-validate them against). Each hop's Location
// header is resolved and checked against the same allowlist before it is
// followed, capped at MAX_INTERNAL_REDIRECTS to avoid an infinite loop.
// `init` (method, body, headers) is replayed verbatim on every hop — unlike
// a browser, this does not downgrade POST to GET on a 301/302/303. That is
// deliberate for an allowlisted internal target: a silent method change is
// its own class of surprise, and a streamed body would fail on the second
// hop either way.
async function fetchWithAllowlistedRedirects(
  url: URL,
  allowHosts: readonly string[],
  init: RequestInit | undefined,
): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_INTERNAL_REDIRECTS; hop++) {
    const res = await fetch(current, withManualRedirect(init));
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
    assertAllowedHost(next, allowHosts);
    current = next;
  }
  throw new Error(`egress(internal): exceeded ${MAX_INTERNAL_REDIRECTS} redirects`);
}
