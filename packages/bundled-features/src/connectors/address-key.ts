import { isIP } from "node:net";

const IPV4_MAPPED_PREFIX_LENGTH = 5;
const IPV6_HEXTET_COUNT = 8;
const IPV6_PREFIX_HEXTETS = 4;

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
