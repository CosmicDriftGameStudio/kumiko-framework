import { isTenantKeyCandidate } from "./constants.js";
import type { HostRoutingOptions, HostRoutingSurface } from "./options.js";

// Only plain DNS names (plus an optional port) are routable. Anything else,
// e.g. userinfo ("a@b"), IPv6 literals or stray characters, never matches a
// configured domain and must not reach URL parsing or a DB lookup.
const HOST_HEADER_PATTERN = /^[a-z0-9.-]+(?::[0-9]{1,5})?$/;

export function normalizeHostname(host: string): string | null {
  const lower = host.trim().toLowerCase();
  if (!HOST_HEADER_PATTERN.test(lower)) return null;
  const colon = lower.indexOf(":");
  const hostname = colon === -1 ? lower : lower.slice(0, colon);
  const withoutTrailingDot = hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
  return withoutTrailingDot === "" ? null : withoutTrailingDot;
}

export type HostClass =
  | { readonly kind: "fixed"; readonly surface: HostRoutingSurface }
  | { readonly kind: "apex" }
  | { readonly kind: "subdomain"; readonly key: string }
  | { readonly kind: "unknown" };

export function classifyHost(host: string, options: HostRoutingOptions): HostClass {
  const hostname = normalizeHostname(host);
  if (hostname === null) return { kind: "unknown" };
  // Own-property check: the Host header is attacker-controlled, and a plain
  // "constructor" would otherwise resolve through Object.prototype.
  const fixed =
    options.hosts !== undefined && Object.hasOwn(options.hosts, hostname)
      ? options.hosts[hostname]
      : undefined;
  if (fixed !== undefined) return { kind: "fixed", surface: fixed };
  const baseDomain = options.baseDomain.toLowerCase();
  if (hostname === baseDomain || hostname === `www.${baseDomain}`) return { kind: "apex" };
  const suffix = `.${baseDomain}`;
  if (!hostname.endsWith(suffix)) return { kind: "unknown" };
  const label = hostname.slice(0, -suffix.length);
  // Exactly one label: "a.b.<baseDomain>" is not a tenant host.
  if (!isTenantKeyCandidate(label)) return { kind: "unknown" };
  return { kind: "subdomain", key: label };
}
