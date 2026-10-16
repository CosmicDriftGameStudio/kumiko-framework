import { describe, expect, test } from "bun:test";
import { isBlockedRequestUrl } from "../egress-guard";

describe("isBlockedRequestUrl", () => {
  test("allows only embedded schemes", () => {
    expect(isBlockedRequestUrl("data:image/png;base64,iVBORw0KGgo=")).toBe(false);
    expect(isBlockedRequestUrl("about:blank")).toBe(false);
    expect(isBlockedRequestUrl("blob:null/1234")).toBe(false);
  });

  test("blocks a public https URL: nothing is fetched from the network", () => {
    expect(isBlockedRequestUrl("https://example.com/logo.png")).toBe(true);
    expect(isBlockedRequestUrl("http://example.com/logo.png")).toBe(true);
  });

  test("blocks loopback, private and cloud-metadata addresses", () => {
    expect(isBlockedRequestUrl("http://127.0.0.1:3000/healthz")).toBe(true);
    expect(isBlockedRequestUrl("http://10.0.0.5/internal")).toBe(true);
    expect(isBlockedRequestUrl("http://169.254.169.254/latest/meta-data/")).toBe(true);
    expect(isBlockedRequestUrl("http://[::ffff:7f00:1]/")).toBe(true);
  });

  test("blocks other schemes (file, ftp, ws)", () => {
    expect(isBlockedRequestUrl("file:///etc/passwd")).toBe(true);
    expect(isBlockedRequestUrl("ftp://example.com/x")).toBe(true);
    expect(isBlockedRequestUrl("ws://example.com/socket")).toBe(true);
  });

  test("blocks unparseable URLs", () => {
    expect(isBlockedRequestUrl("not a url")).toBe(true);
  });
});
