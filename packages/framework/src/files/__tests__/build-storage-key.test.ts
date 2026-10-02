import { describe, expect, test } from "bun:test";
import {
  assertSafeStorageKey,
  buildStorageKey,
  tenantExportPrefix,
  tenantStoragePrefixes,
} from "../types.js";

describe("buildStorageKey", () => {
  test("uses the lowercased extension for a normal filename", () => {
    const key = buildStorageKey("T1" as never, "invoice", 1, "attachment", "logo.PNG", "u1");
    expect(key).toBe("T1/invoice/1/attachment/u1.png");
  });

  test("uses the sole segment as extension when there is no dot", () => {
    const key = buildStorageKey("T1" as never, "invoice", 1, "attachment", "noext", "u1");
    expect(key).toBe("T1/invoice/1/attachment/u1.noext");
  });

  test("rejects a path-traversal filename and falls back to bin instead of leaking the payload", () => {
    const key = buildStorageKey(
      "T1" as never,
      "unattached",
      "file",
      "u",
      "a.b/../../../../evil",
      "u1",
    );
    expect(key).toBe("T1/unattached/file/u/u1.bin");
    expect(key).not.toContain("..");
    expect(key.split("/")).toHaveLength(5);
  });
});

describe("tenant storage prefixes", () => {
  const tenant = "T1" as never;

  test("tenantExportPrefix is a fixed leading exports/ segment ending in a slash", () => {
    const prefix = tenantExportPrefix(tenant);
    expect(prefix).toBe("exports/T1/");
    expect(prefix.startsWith("T1")).toBe(false);
    expect(prefix.endsWith("/")).toBe(true);
  });

  test("tenantStoragePrefixes covers both the upload layout and the export layout", () => {
    const prefixes = tenantStoragePrefixes(tenant);
    expect(prefixes).toContain("T1/");
    expect(prefixes).toContain(tenantExportPrefix(tenant));
  });

  test("a buildStorageKey() key always starts with one of the tenant's sweep prefixes", () => {
    const key = buildStorageKey(tenant, "invoice", 1, "attachment", "logo.png", "u1");
    expect(tenantStoragePrefixes(tenant).some((prefix) => key.startsWith(prefix))).toBe(true);
  });
});

describe("assertSafeStorageKey", () => {
  test("accepts a normal key", () => {
    expect(() => assertSafeStorageKey("T1/invoice/1/attachment/u1.png")).not.toThrow();
  });

  test.each(["T1/../T2/x.png", "./x.png", "T1/a/.."])("rejects traversal segment in %s", (key) => {
    expect(() => assertSafeStorageKey(key)).toThrow(/path-traversal/);
  });
});
