// Egress-guard against SSRF (enterprise#267): rendering arbitrary HTML can
// trigger real requests from the render pod via <img>/<link>/@import.
// K8s-NetworkPolicy alone is not sufficient (old render.ts comment assumed
// incorrectly) — we additionally block at the application level.
//
// ponytail: blocks IP literals + the first DNS resolve per hostname; a host
// that switches from public to private between our lookup and Chromium's own
// fetch (DNS rebinding) slips through. Upgrade when needed: pin the resolve
// + force Chromium via --host-resolver-rules.

import { promises as dns } from "node:dns";
import { BlockList, isIP } from "node:net";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "data:", "about:", "blob:"]);
const NO_LOOKUP_PROTOCOLS = new Set(["data:", "about:", "blob:"]);

// net.BlockList treats IPv4-mapped IPv6 (incl. expanded 0:0:0:0:0:ffff:…) correctly;
// hand-rolled prefix matching did not (enterprise#272).
const PRIVATE = new BlockList();
PRIVATE.addSubnet("0.0.0.0", 8, "ipv4");
PRIVATE.addSubnet("10.0.0.0", 8, "ipv4");
PRIVATE.addSubnet("127.0.0.0", 8, "ipv4");
PRIVATE.addSubnet("169.254.0.0", 16, "ipv4");
PRIVATE.addSubnet("172.16.0.0", 12, "ipv4");
PRIVATE.addSubnet("192.168.0.0", 16, "ipv4");
PRIVATE.addSubnet("100.64.0.0", 10, "ipv4"); // CGNAT
PRIVATE.addSubnet("192.0.0.0", 24, "ipv4");
PRIVATE.addSubnet("198.18.0.0", 15, "ipv4");
PRIVATE.addSubnet("224.0.0.0", 4, "ipv4"); // multicast
PRIVATE.addAddress("255.255.255.255", "ipv4");
PRIVATE.addAddress("::1", "ipv6");
PRIVATE.addAddress("::", "ipv6");
PRIVATE.addSubnet("fe80::", 10, "ipv6"); // link-local (fe80–febf)
PRIVATE.addSubnet("fc00::", 7, "ipv6"); // ULA

export function isPrivateOrLinkLocalIp(ip: string, family: 4 | 6): boolean {
  try {
    return PRIVATE.check(ip, family === 6 ? "ipv6" : "ipv4");
  } catch {
    return true; // unparseable → fail closed
  }
}

export async function isBlockedRequestUrl(rawUrl: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return true;
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return true;
  if (NO_LOOKUP_PROTOCOLS.has(url.protocol)) return false;

  const hostname = url.hostname;
  const literalFamily = isIP(hostname);
  if (literalFamily) {
    return isPrivateOrLinkLocalIp(hostname, literalFamily === 6 ? 6 : 4);
  }
  try {
    const records = await dns.lookup(hostname, { all: true });
    return records.some((r) => isPrivateOrLinkLocalIp(r.address, r.family === 6 ? 6 : 4));
  } catch {
    return true; // DNS lookup failed → fail closed
  }
}
