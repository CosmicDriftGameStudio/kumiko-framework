import type { Context } from "hono";

// Single source for client-IP extraction, shared by every IP-keyed rate
// limit and audit field. Deriving the caller IP independently per call site
// makes it easy for one to silently trust the first XFF entry, which is
// attacker-controlled unless the exact number of trusted reverse proxies is
// known.
//
// Algorithm for `trustedProxyHops`:
//   0 (default): don't trust any proxy header — only the socket address
//   counts. A spoofed XFF is ignored outright.
//   >=1: each trusted proxy hop APPENDS (not overwrites) its peer address to
//   XFF (e.g. nginx `$proxy_add_x_forwarded_for`), so the real client sits
//   at `entries[length - hops]`. Anything a client itself prepended lands
//   further left and is ignored. A chain shorter than `hops` falls back to
//   `x-real-ip` (no hop-count semantics of its own), then the socket address.
// A bucket is never skipped: without any usable value the fallback is a
// fixed "unknown" string, which collapses affected callers into one shared
// bucket rather than letting them bypass the limit entirely.
export const UNKNOWN_CLIENT_IP = "unknown";

export type ClientIpHeaderSource = {
  readonly header: (name: string) => string | undefined;
  readonly socketAddress?: string;
};

export type ClientIpResolver = {
  readonly resolve: (source: ClientIpHeaderSource) => string;
};

// The socket address rides in as Hono's `Env` (2nd `app.fetch` arg, read
// back via `c.env`) as a bare string, never the raw Bun `Server` — a
// `Server.requestIP()` only resolves for the exact Request instance Bun
// created, and a cloned/rebuilt Request (tryHonoFirst's req.clone(), etc.)
// would silently return null. The address is extracted once at the
// outermost Bun.serve fetch handler and threaded down as a plain value.
// WebSocket-upgrade requests carry `{ socketAddress, server }` instead (see
// KumikoServeEnv) — the server handle is needed for `server.upgrade`.
export function extractSocketAddress(honoEnv: unknown): string | undefined {
  if (typeof honoEnv === "string") return honoEnv.length > 0 ? honoEnv : undefined;
  if (hasSocketAddress(honoEnv) && honoEnv.socketAddress.length > 0) return honoEnv.socketAddress;
  return undefined;
}

function hasSocketAddress(value: unknown): value is { readonly socketAddress: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "socketAddress" in value &&
    typeof value.socketAddress === "string"
  );
}

export function assertValidTrustedProxyHops(value: number | undefined, context: string): void {
  if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
    throw new Error(`${context}: trustedProxyHops must be a non-negative integer, got ${value}.`);
  }
}

export const TRUSTED_PROXY_HOPS_ENV = "KUMIKO_TRUSTED_PROXY_HOPS";

// Fail loud on a garbage env value rather than silently coercing to NaN:
// a resolver built from NaN treats it like "always short chain" and returns
// "unknown" for every request, which collapses an IP-keyed rate limiter
// into one shared bucket for the whole deployment — a self-inflicted DoS,
// worse than staying on the default. Digits-only (not parseInt) —
// parseInt("0x10")/("1e3")/("2x") would silently coerce instead of failing.
export function parseTrustedProxyHopsEnv(
  raw: string | undefined,
  context: string,
): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw)) {
    throw new Error(
      `${context}: ${TRUSTED_PROXY_HOPS_ENV} must be a non-negative integer, got "${raw}".`,
    );
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(
      `${context}: ${TRUSTED_PROXY_HOPS_ENV} must be a non-negative integer, got "${raw}".`,
    );
  }
  return parsed;
}

// Instance-scoped, NOT a module singleton: the warn-once flag must reset
// per server boot (and per test), otherwise the first test to trigger it
// consumes the warning for the whole process and later tests can't observe
// it.
export function createClientIpResolver(
  trustedProxyHops: number,
  context = "resolveClientIp",
): ClientIpResolver {
  assertValidTrustedProxyHops(trustedProxyHops, context);
  let warnedUnexpectedForwardedFor = false;

  function resolve(source: ClientIpHeaderSource): string {
    const xff = source.header("x-forwarded-for");
    if (trustedProxyHops === 0) {
      if (xff !== undefined && xff.trim().length > 0 && !warnedUnexpectedForwardedFor) {
        warnedUnexpectedForwardedFor = true;
        console.warn(
          "[kumiko] received X-Forwarded-For but trustedProxyHops is 0 (no proxy trusted) — " +
            "ignoring it. Running behind a proxy? Set trustedProxyHops, otherwise all clients " +
            "share one rate-limit bucket.",
        );
      }
      return source.socketAddress ?? UNKNOWN_CLIENT_IP;
    }
    const entries = (xff ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    if (entries.length >= trustedProxyHops) {
      return entries[entries.length - trustedProxyHops] ?? UNKNOWN_CLIENT_IP;
    }
    const realIp = source.header("x-real-ip")?.trim();
    if (realIp) return realIp;
    return source.socketAddress ?? UNKNOWN_CLIENT_IP;
  }

  return { resolve };
}

export function clientIpSourceFromHonoContext(c: Context): ClientIpHeaderSource {
  return {
    header: (name) => c.req.header(name),
    socketAddress: extractSocketAddress(c.env),
  };
}
