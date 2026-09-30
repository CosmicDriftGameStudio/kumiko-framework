// extractAuditMeta takes the framework-resolved clientIp instead of reading
// X-Forwarded-For itself, so a caller can't plant a fake audit IP.
import { describe, expect, test } from "bun:test";
import { UNKNOWN_CLIENT_IP } from "@cosmicdrift/kumiko-framework/api";
import { extractAuditMeta } from "../feature.js";

describe("extractAuditMeta", () => {
  test("uses the resolved clientIp, ignoring a spoofed X-Forwarded-For header on the same request", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.1, 10.0.0.1",
      "x-real-ip": "203.0.113.1",
      "user-agent": "test-agent",
    });

    const auditMeta = extractAuditMeta(headers, "198.51.100.7");

    expect(auditMeta.ip).toBe("198.51.100.7");
    expect(auditMeta.ip).not.toBe("203.0.113.1");
    expect(auditMeta.userAgent).toBe("test-agent");
  });

  test("maps the resolver's unknown sentinel to null instead of storing the literal string", () => {
    const auditMeta = extractAuditMeta(new Headers(), UNKNOWN_CLIENT_IP);

    expect(auditMeta.ip).toBeNull();
  });

  test("reads user-agent from headers independently of the resolved IP", () => {
    const auditMeta = extractAuditMeta(
      new Headers({ "user-agent": "spoofable-but-fine" }),
      "1.2.3.4",
    );

    expect(auditMeta.userAgent).toBe("spoofable-but-fine");
  });
});
