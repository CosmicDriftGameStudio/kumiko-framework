// Egress trust boundary. `EgressPolicy` and the checks below back the single
// exported way to speak outward, `egress()` in ./egress.ts — this module and
// its exports stay off the package's public barrel (index.ts) on purpose:
// call sites bind a policy once via `egress(policy)` and never see the range
// table or the allowlist check directly.
//
// `external` and `tenant-supplied` resolve to the identical set of checks
// below (deny private/reserved/link-local + no redirects). They stay
// separate policy kinds because they carry different trust semantics — a
// tenant-controlled URL is adversary-input in a way a hardcoded external
// endpoint is not.
//
// DNS-rebinding protection: `resolvePublicHost` resolves the hostname
// exactly once, validates every returned address, and hands back the one
// address ./egress.ts connects to directly (fetch-by-IP, with the original
// hostname preserved for the Host header and TLS SNI/cert validation).
// There is no second resolution for an attacker-controlled DNS answer to
// swap in between check and connect — see `resolvePublicHost` below for the
// mechanism and ../__tests__/egress.test.ts / policy.test.ts for the tests
// pinning it.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type EgressPolicy =
  | { readonly kind: "external" }
  | { readonly kind: "internal"; readonly allowHosts: readonly string[] }
  | { readonly kind: "tenant-supplied" };

export function isBlockedIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isBlockedV4(ip);
  if (kind === 6) return isBlockedV6(ip);
  return true; // not parseable as an IP -> fail closed
}

function isBlockedV4(ip: string): boolean {
  const [a = 0, b = 0] = ip.split(".").map(Number);
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 10) return true; // 10/8 private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
  if (a === 192 && b === 168) return true; // 192.168/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a >= 224) return true; // multicast/reserved
  return false;
}

// WHATWG URL host-parsing always serializes IPv6 into the canonical
// compressed lowercase form (RFC 5952) regardless of the input shape —
// uncompressed groups, embedded IPv4-dotted notation, mixed case all collapse
// to one string. isBlockedV6 below only has to handle that one shape, so any
// caller-supplied IPv6 literal is normalized through `new URL()` first.
function canonicalIPv6(ip: string): string {
  try {
    return new URL(`http://[${ip}]/`).hostname.replace(/^\[/, "").replace(/\]$/, "");
  } catch {
    return ip; // unparsable — falls through to the (fail-closed) checks below
  }
}

// Two 16-bit hex groups, as WHATWG URL serializes an embedded IPv4 address
// inside an IPv6 literal, decoded back into the v4 range rules.
function isBlockedHexPair(hi: string | undefined, lo: string | undefined): boolean {
  const hiNum = Number.parseInt(hi ?? "0", 16);
  const loNum = Number.parseInt(lo ?? "0", 16);
  return isBlockedV4(`${hiNum >>> 8}.${hiNum & 0xff}.${loNum >>> 8}.${loNum & 0xff}`);
}

function isBlockedV6(ip: string): boolean {
  const lower = canonicalIPv6(ip.toLowerCase());
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  const mappedDotted = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedDotted) return isBlockedV4(mappedDotted[1] ?? "0.0.0.0"); // IPv4-mapped -> v4 rules
  const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) return isBlockedHexPair(mappedHex[1], mappedHex[2]); // IPv4-mapped, hex form
  // NAT64 well-known prefix (RFC 6052) embeds an IPv4 address in the low 32
  // bits, same trick as the IPv4-mapped form above with a different prefix —
  // a known SSRF-filter-bypass technique on NAT64/DNS64 networks.
  const nat64 = lower.match(/^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (nat64) return isBlockedHexPair(nat64[1], nat64[2]);
  // 6to4 (RFC 3056) embeds an IPv4 address directly after the 2002: prefix.
  const sixToFour = lower.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})(?::|$)/);
  if (sixToFour) return isBlockedHexPair(sixToFour[1], sixToFour[2]);
  const head = Number.parseInt(lower.split(":")[0] || "0", 16);
  const highByte = head >>> 8;
  if (highByte === 0xfc || highByte === 0xfd) return true; // fc00::/7 unique-local
  if (head >= 0xfe80 && head <= 0xfebf) return true; // fe80::/10 link-local
  // fec0::/10 is deprecated IPv6 site-local (RFC 3879, 2004) — no DNS server
  // hands this out today, but this is an exported security boundary, so block
  // it rather than lean on the deprecation.
  if (head >= 0xfec0 && head <= 0xfeff) return true;
  return false;
}

function stripBrackets(host: string): string {
  return host.replace(/^\[/, "").replace(/\]$/, "");
}

export function assertHttpScheme(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`egress: unsupported scheme ${url.protocol}`);
  }
}

export interface ResolvedHost {
  readonly address: string;
  readonly family: 4 | 6;
}

// Denies private/reserved/link-local ranges for `external` and
// `tenant-supplied`, and pins the exact address ./egress.ts must connect to.
// Resolves the hostname's A/AAAA records (or reads the literal IP directly),
// rejects if ANY resolved address falls in a denied range — a host with one
// public and one private record must not pass — and returns ONE validated
// address from that same resolution. Reusing that address for the connect,
// instead of letting `fetch()` resolve the hostname again, is what closes
// the DNS-rebinding window: there is no second lookup left for an
// attacker-controlled DNS server to answer differently.
//
// `lookupFn` defaults to the real resolver and exists only so tests can pin
// deterministic, network-free answers — production call sites never pass it.
export async function resolvePublicHost(
  url: URL,
  lookupFn: typeof lookup = lookup,
): Promise<ResolvedHost> {
  if (url.username || url.password) {
    throw new Error("egress: URLs with embedded credentials are not supported");
  }
  const host = stripBrackets(url.hostname);
  const ipVersion = isIP(host);
  if (ipVersion !== 0) {
    if (isBlockedIp(host)) throw new Error(`egress: host is not a public address: ${host}`);
    return { address: host, family: ipVersion === 6 ? 6 : 4 };
  }
  let addresses: readonly { readonly address: string; readonly family: number }[];
  try {
    addresses = await lookupFn(host, { all: true });
  } catch {
    throw new Error(`egress: DNS resolution failed for host: ${host}`);
  }
  if (addresses.length === 0) {
    throw new Error(`egress: DNS resolution returned no records for host: ${host}`);
  }
  const blocked = addresses.find((a) => isBlockedIp(a.address));
  if (blocked) {
    throw new Error(`egress: host resolves to a non-public address: ${host} -> ${blocked.address}`);
  }
  const [chosen] = addresses;
  if (!chosen) {
    throw new Error(`egress: DNS resolution returned no records for host: ${host}`);
  }
  return { address: chosen.address, family: chosen.family === 6 ? 6 : 4 };
}

// Explicit allowlist check for `internal` — the hostname (not the resolved
// IP) must appear verbatim (case-insensitive) in `allowHosts`. No range
// check: `internal` targets are deliberately private/cluster-local.
// `allowHosts` is a host allowlist, not an origin allowlist: it is
// deliberately port- and scheme-agnostic (`svc.internal` also admits
// `svc.internal:9999` over http or https) — `EgressPolicy` doesn't carry a
// port or scheme in its shape, so there is nothing more specific to check.
export function assertAllowedHost(url: URL, allowHosts: readonly string[]): void {
  const host = stripBrackets(url.hostname).toLowerCase();
  const allowed = allowHosts.some((h) => h.toLowerCase() === host);
  if (!allowed) {
    throw new Error(`egress: host not in allowlist: ${host}`);
  }
}
