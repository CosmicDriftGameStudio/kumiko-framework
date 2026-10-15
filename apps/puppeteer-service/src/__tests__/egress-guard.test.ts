import { describe, expect, test } from "bun:test";
import { isBlockedRequestUrl, isPrivateOrLinkLocalIp } from "../egress-guard";

describe("isPrivateOrLinkLocalIp", () => {
  test("blocks RFC1918 + loopback + link-local (incl. cloud metadata) v4", () => {
    for (const ip of [
      "10.0.0.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "127.0.0.1",
      "169.254.169.254",
      "100.64.0.1", // CGNAT
      "192.0.0.1",
      "198.18.0.1",
      "224.0.0.1", // multicast
      "255.255.255.255",
    ]) {
      expect(isPrivateOrLinkLocalIp(ip, 4)).toBe(true);
    }
  });

  test("allows public v4 IPs", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34"]) {
      expect(isPrivateOrLinkLocalIp(ip, 4)).toBe(false);
    }
  });

  test("blocks v6 loopback + link-local + ULA", () => {
    for (const ip of ["::1", "fe80::1", "febf::1", "fc00::1", "fd00::1"]) {
      expect(isPrivateOrLinkLocalIp(ip, 6)).toBe(true);
    }
  });

  test("allows public v6 IPs", () => {
    expect(isPrivateOrLinkLocalIp("2606:4700:4700::1111", 6)).toBe(false);
  });

  test("blocks IPv4-mapped IPv6 (compressed and expanded)", () => {
    expect(isPrivateOrLinkLocalIp("::ffff:127.0.0.1", 6)).toBe(true);
    expect(isPrivateOrLinkLocalIp("::ffff:7f00:1", 6)).toBe(true);
    expect(isPrivateOrLinkLocalIp("0:0:0:0:0:ffff:127.0.0.1", 6)).toBe(true);
    expect(isPrivateOrLinkLocalIp("0:0:0:0:0:ffff:10.0.0.1", 6)).toBe(true);
  });
});

describe("isBlockedRequestUrl", () => {
  test("blocks cloud-metadata IP directly", async () => {
    expect(await isBlockedRequestUrl("http://169.254.169.254/latest/meta-data/")).toBe(true);
  });

  test("blocks private IP literals", async () => {
    expect(await isBlockedRequestUrl("http://10.0.0.5/internal")).toBe(true);
    expect(await isBlockedRequestUrl("https://192.168.1.1/admin")).toBe(true);
  });

  test("blocks expanded IPv4-mapped loopback URL", async () => {
    expect(await isBlockedRequestUrl("http://[0:0:0:0:0:ffff:127.0.0.1]/")).toBe(true);
    expect(await isBlockedRequestUrl("http://[::ffff:7f00:1]/")).toBe(true);
  });

  test("blocks CGNAT / benchmarking / multicast literals", async () => {
    expect(await isBlockedRequestUrl("http://100.64.1.2/x")).toBe(true);
    expect(await isBlockedRequestUrl("http://198.18.0.1/x")).toBe(true);
    expect(await isBlockedRequestUrl("http://224.0.0.1/x")).toBe(true);
  });

  test("allows public http/https URLs (IP literal, no DNS in test)", async () => {
    expect(await isBlockedRequestUrl("https://8.8.8.8/logo.png")).toBe(false);
  });

  test("allows data: URIs without lookup", async () => {
    expect(await isBlockedRequestUrl("data:image/png;base64,iVBORw0KGgo=")).toBe(false);
  });

  test("blocks disallowed schemes (file:, ftp:)", async () => {
    expect(await isBlockedRequestUrl("file:///etc/passwd")).toBe(true);
    expect(await isBlockedRequestUrl("ftp://example.com/x")).toBe(true);
  });

  test("blocks unparseable URLs", async () => {
    expect(await isBlockedRequestUrl("not a url")).toBe(true);
  });
});
