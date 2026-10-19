import { isTenantKeyCandidate } from "./constants.ts";
import type { HostRoutingOptions, HostRoutingSurface } from "./options.ts";

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
  // tenantBy resolver mode: any host that is neither fixed nor apex.
  | { readonly kind: "resolved"; readonly hostname: string }
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
  if (isApexHostname(hostname, options.baseDomain)) return { kind: "apex" };
  const baseDomain = options.baseDomain.toLowerCase();
  if (typeof options.tenantBy === "function") return { kind: "resolved", hostname };
  const suffix = `.${baseDomain}`;
  if (!hostname.endsWith(suffix)) return { kind: "unknown" };
  const label = hostname.slice(0, -suffix.length);
  // Exactly one label: "a.b.<baseDomain>" is not a tenant host.
  if (!isTenantKeyCandidate(label)) return { kind: "unknown" };
  return { kind: "subdomain", key: label };
}

export function splitFirstSegment(path: string): {
  readonly segment: string;
  readonly rest: string;
} {
  const withoutLeading = path.replace(/^\/+/, "");
  const slash = withoutLeading.indexOf("/");
  if (slash === -1) return { segment: withoutLeading, rest: "/" };
  return { segment: withoutLeading.slice(0, slash), rest: withoutLeading.slice(slash) };
}

// undefined: path is outside the prefix; null: bare prefix without a key.
export function tenantKeyFromPath(prefix: string, path: string): string | null | undefined {
  if (path !== prefix && !path.startsWith(`${prefix}/`)) return undefined;
  const { segment } = splitFirstSegment(path.slice(prefix.length));
  return segment === "" ? null : segment;
}

// Apex hostnames are the only ones that may carry a path-named tenant or an
// anonymous anchor tenant.
export function isApexHostname(hostname: string, baseDomain: string): boolean {
  const base = baseDomain.toLowerCase();
  return hostname === base || hostname === `www.${base}`;
}
