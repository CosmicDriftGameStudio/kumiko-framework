import { describe, expect, test } from "bun:test";
import { assertAllowedHost, assertHttpScheme, assertPublicHost, isBlockedIp } from "../policy";

describe("isBlockedIp", () => {
  test.each([
    ["169.254.169.254", true], // cloud metadata — the core SSRF target
    ["10.0.0.1", true],
    ["172.16.5.4", true],
    ["172.31.255.255", true],
    ["192.168.1.1", true],
    ["127.0.0.1", true],
    ["0.0.0.0", true],
    ["100.64.0.1", true], // CGNAT
    ["224.0.0.1", true], // multicast
    ["::1", true],
    ["fc00::1", true], // unique-local
    ["fe80::1", true], // link-local
    ["::ffff:10.0.0.1", true], // IPv4-mapped private (dotted form)
    ["::ffff:a9fe:a9fe", true], // IPv4-mapped cloud metadata (hex form, as new URL() normalizes it)
    ["0:0:0:0:0:ffff:169.254.169.254", true], // same address, uncompressed + dotted
    ["0:0:0:0:0:ffff:a9fe:a9fe", true], // same address, uncompressed + hex
    ["fec0::1", true], // deprecated site-local, RFC 3879
    ["FEC0:0:0:0:0:0:0:1", true], // same range, uncompressed + uppercase
    ["feff::1", true], // upper end of fec0::/10
    ["64:ff9b::169.254.169.254", true], // NAT64-embedded cloud metadata (RFC 6052)
    ["2002:a9fe:a9fe::", true], // 6to4-embedded cloud metadata (RFC 3056)
    ["not-an-ip", true], // fail closed
    ["8.8.8.8", false],
    ["1.1.1.1", false],
    ["172.15.0.1", false], // just outside 172.16/12
    ["172.32.0.1", false],
    ["93.184.216.34", false],
    ["2606:2800:220:1:248:1893:25c8:1946", false],
    ["64:ff9b::8.8.8.8", false], // NAT64-embedded public IP
    ["2002:808:808::", false], // 6to4-embedded public IP (8.8.8.8)
  ])("%s -> blocked=%p", (ip, blocked) => {
    expect(isBlockedIp(ip)).toBe(blocked);
  });
});

describe("assertHttpScheme", () => {
  test("accepts http and https", () => {
    expect(() => assertHttpScheme(new URL("http://example.com"))).not.toThrow();
    expect(() => assertHttpScheme(new URL("https://example.com"))).not.toThrow();
  });

  test("rejects other schemes", () => {
    expect(() => assertHttpScheme(new URL("file:///etc/passwd"))).toThrow();
    expect(() => assertHttpScheme(new URL("ftp://example.com"))).toThrow();
  });
});

describe("assertPublicHost", () => {
  test("rejects a literal private-IP host without any DNS lookup", async () => {
    await expect(
      assertPublicHost(new URL("http://169.254.169.254/latest/meta-data/")),
    ).rejects.toThrow();
  });

  test("rejects the hex IPv4-mapped form new URL() normalizes ::ffff:169.254.169.254 into", async () => {
    await expect(assertPublicHost(new URL("http://[::ffff:169.254.169.254]/"))).rejects.toThrow();
  });

  test("allows a public IP-literal host", async () => {
    await expect(assertPublicHost(new URL("http://93.184.216.34/"))).resolves.toBeUndefined();
  });
});

describe("assertAllowedHost", () => {
  test("allows a host present in allowHosts (case-insensitive)", () => {
    expect(() =>
      assertAllowedHost(new URL("http://Internal-Service.local/"), ["internal-service.local"]),
    ).not.toThrow();
  });

  test("rejects a host absent from allowHosts", () => {
    expect(() =>
      assertAllowedHost(new URL("http://other.local/"), ["internal-service.local"]),
    ).toThrow();
  });
});
