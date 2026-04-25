import { describe, expect, test } from "vitest";
import { parseTenantId } from "../types/identifiers";

describe("parseTenantId", () => {
  test("accepts canonical lowercase UUIDs", () => {
    expect(parseTenantId("00000000-0000-4000-8000-000000000001")).toBe(
      "00000000-0000-4000-8000-000000000001",
    );
  });

  test("rejects non-UUID strings", () => {
    expect(parseTenantId("not-a-uuid")).toBeNull();
    expect(parseTenantId("acme")).toBeNull();
    expect(parseTenantId("")).toBeNull();
  });

  test("rejects SQL-injection-shaped probes", () => {
    expect(parseTenantId("'; DROP TABLE tenants; --")).toBeNull();
    expect(parseTenantId("../../../etc/passwd")).toBeNull();
  });

  test("rejects uppercase UUIDs (canonical form is lowercase)", () => {
    // The framework writes lowercase everywhere — accepting uppercase here
    // would let two different strings produce the same logical tenant and
    // diverge on string-equality checks downstream.
    expect(parseTenantId("00000000-0000-4000-8000-00000000000A")).toBeNull();
  });

  test("rejects non-string inputs", () => {
    expect(parseTenantId(undefined)).toBeNull();
    expect(parseTenantId(null)).toBeNull();
    expect(parseTenantId(123)).toBeNull();
    expect(parseTenantId({})).toBeNull();
  });
});
