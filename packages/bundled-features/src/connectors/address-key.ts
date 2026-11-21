import { isIP } from "node:net";

const IPV4_MAPPED_PREFIX_LENGTH = 5;
const IPV6_HEXTET_COUNT = 8;
const IPV6_PREFIX_HEXTETS = 4;
const IPV6_LOOPBACK = "::1";

// Kept apart from the /64 cut: the rest of ::/64 (`::`, IPv4-compatible forms) is not loopback.
function isIpv6Loopback(hextets: readonly number[]): boolean {
  return hextets.every((hextet, index) => hextet === (index === IPV6_HEXTET_COUNT - 1 ? 1 : 0));
}

function ipv6Hextets(ip: string): number[] {
  let text = ip;
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted !== null) {
    const [a = 0, b = 0, c = 0, d = 0] = dotted.slice(1).map(Number);
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = "", tail] = text.split("::");
  const headParts = head === "" ? [] : head.split(":");
  const tailParts = tail === undefined || tail === "" ? [] : tail.split(":");
  const fill =
    tail === undefined
      ? []
      : Array.from({ length: IPV6_HEXTET_COUNT - headParts.length - tailParts.length }, () => "0");
  return [...headParts, ...fill, ...tailParts].map((hextet) => Number.parseInt(hextet, 16));
}

// One IPv6 subscriber holds a whole /64, so a per-address limit keyed on the exact address is
// bypassed by taking a fresh address per request. IPv4 and anything that is not an IP stay as is.
export function pairingAddressKey(ip: string): string {
  const bare = ip.split("%")[0] ?? ip;
  if (isIP(bare) !== 6) return ip;
  const hextets = ipv6Hextets(bare);
  if (isIpv6Loopback(hextets)) return IPV6_LOOPBACK;
  const [h6 = 0, h7 = 0] = hextets.slice(6);
  const isMapped =
    hextets.slice(0, IPV4_MAPPED_PREFIX_LENGTH).every((hextet) => hextet === 0) &&
    hextets[IPV4_MAPPED_PREFIX_LENGTH] === 0xffff;
  if (isMapped) return `${h6 >> 8}.${h6 & 0xff}.${h7 >> 8}.${h7 & 0xff}`;
  return `${hextets
    .slice(0, IPV6_PREFIX_HEXTETS)
    .map((hextet) => hextet.toString(16))
    .join(":")}::/64`;
}

const STORED_PREFIX_PATTERN = /^([0-9a-f]{1,4}(?::[0-9a-f]{1,4}){3})::\/64$/;
const LOOPBACK_IPV4_PATTERN = /^127\./;

function compressIpv6(hextets: readonly string[]): string {
  let best = { start: -1, length: 0 };
  for (let start = 0; start < hextets.length; start += 1) {
    let end = start;
    while (end < hextets.length && hextets[end] === "0") end += 1;
    if (end - start > best.length) best = { start, length: end - start };
  }
  if (best.length < 2) return hextets.join(":");
  const head = hextets.slice(0, best.start).join(":");
  const tail = hextets.slice(best.start + best.length).join(":");
  return `${head}::${tail}`;
}

// What the admin reads on the confirm step: the stored key in RFC 5952 form (`2001:db8:1:2::/64`),
// plus `local` for a loopback address: behind a proxy without a trusted client-IP header every
// request arrives from there, so it says nothing about the real sender. The address stays visible.
export function pairingAddressDisplay(storedKey: string): {
  readonly kind: "local" | "address";
  readonly text: string;
} {
  if (LOOPBACK_IPV4_PATTERN.test(storedKey) || storedKey === IPV6_LOOPBACK) {
    return { kind: "local", text: storedKey };
  }
  const prefix = STORED_PREFIX_PATTERN.exec(storedKey)?.[1];
  if (prefix === undefined) return { kind: "address", text: storedKey };
  const hextets = [
    ...prefix.split(":").map((hextet) => hextet.replace(/^0+(?=.)/, "")),
    ...Array(4).fill("0"),
  ];
  return { kind: "address", text: `${compressIpv6(hextets)}/64` };
}
