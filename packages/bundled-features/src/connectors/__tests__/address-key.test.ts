import { describe, expect, test } from "bun:test";
import { pairingAddressDisplay, pairingAddressKey } from "../address-key.ts";

describe("pairingAddressKey", () => {
  test("keeps an IPv4 address and a non-IP value as they are", () => {
    expect(pairingAddressKey("203.0.113.7")).toBe("203.0.113.7");
    expect(pairingAddressKey("unknown")).toBe("unknown");
  });

  test("cuts a full IPv6 address to its /64 prefix", () => {
    expect(pairingAddressKey("2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
  });

  test("expands a shortened IPv6 address before cutting it", () => {
    expect(pairingAddressKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(pairingAddressKey("2001:db8:1:2::ffff")).toBe("2001:db8:1:2::/64");
    expect(pairingAddressKey("::1")).toBe("0:0:0:0::/64");
  });

  test("two addresses of one /64 share a key, another /64 does not", () => {
    expect(pairingAddressKey("2001:db8:1:2::1")).toBe(pairingAddressKey("2001:db8:1:2:f::9"));
    expect(pairingAddressKey("2001:db8:1:3::1")).not.toBe(pairingAddressKey("2001:db8:1:2::1"));
  });

  test("treats an IPv4-mapped IPv6 address as the IPv4 address", () => {
    expect(pairingAddressKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(pairingAddressKey("::ffff:cb00:7107")).toBe("203.0.113.7");
  });

  test("ignores a zone id", () => {
    expect(pairingAddressKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
  });
});

describe("pairingAddressDisplay", () => {
  test("shows a /64 prefix in the compact RFC 5952 form", () => {
    expect(pairingAddressDisplay(pairingAddressKey("2001:db8:1:2::1"))).toEqual({
      kind: "address",
      text: "2001:db8:1:2::/64",
    });
    expect(pairingAddressDisplay(pairingAddressKey("2001:db8::1"))).toEqual({
      kind: "address",
      text: "2001:db8::/64",
    });
    expect(pairingAddressDisplay(pairingAddressKey("fe80::1%eth0"))).toEqual({
      kind: "address",
      text: "fe80::/64",
    });
  });

  test("names loopback as local, in IPv6 and IPv4", () => {
    expect(pairingAddressDisplay(pairingAddressKey("::1"))).toEqual({ kind: "local" });
    expect(pairingAddressDisplay("0:0:0:0::/64")).toEqual({ kind: "local" });
    expect(pairingAddressDisplay("127.0.0.1")).toEqual({ kind: "local" });
  });

  test("leaves IPv4 and other text as it is", () => {
    expect(pairingAddressDisplay("203.0.113.7")).toEqual({ kind: "address", text: "203.0.113.7" });
    expect(pairingAddressDisplay("unknown")).toEqual({ kind: "address", text: "unknown" });
  });
});
