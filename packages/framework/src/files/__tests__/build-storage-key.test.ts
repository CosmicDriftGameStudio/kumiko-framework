import { describe, expect, test } from "bun:test";
import {
  assertSafeStorageKey,
  buildNoBackupStorageKey,
  buildStorageKey,
  isOwnUploadKey,
  tenantExportPrefix,
  tenantNoBackupPrefix,
  tenantStoragePrefixes,
} from "../types.ts";

describe("buildStorageKey", () => {
  test("uses the lowercased extension for a normal filename", () => {
    const key = buildStorageKey("T1" as never, "invoice", 1, "attachment", "logo.PNG", "u1");
    expect(key).toBe("T1/invoice/1/attachment/u1.png");
  });

  test("uses the sole segment as extension when there is no dot", () => {
    const key = buildStorageKey("T1" as never, "invoice", 1, "attachment", "noext", "u1");
    expect(key).toBe("T1/invoice/1/attachment/u1.noext");
  });

  test.each([undefined, ""])("never produces an empty segment when entityId is %p", (entityId) => {
    const key = buildStorageKey("T1" as never, "unattached", entityId, "file", "a.xml", "u1");
    expect(key).toBe("T1/unattached/none/file/u1.xml");
    expect(key.split("/").every((segment) => segment !== "")).toBe(true);
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

  test("a tenant named like the reserved exports segment is rejected", () => {
    expect(() => tenantExportPrefix("exports" as never)).toThrow();
    expect(() => tenantStoragePrefixes("exports" as never)).toThrow();
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

describe("no-backup keys", () => {
  const tenant = "T1" as never;

  test("sit under the nobackup prefix of their tenant, which the destroy sweep covers", () => {
    const key = buildNoBackupStorageKey(tenant, "unattached", undefined, "file", "a.pdf", "u1");
    expect(key).toBe("nobackup/T1/unattached/none/file/u1.pdf");
    expect(key.startsWith(tenantNoBackupPrefix(tenant))).toBe(true);
    expect(tenantStoragePrefixes(tenant)).toContain("nobackup/T1/");
  });

  test("refuse a tenant named like the reserved segment", () => {
    expect(() => tenantNoBackupPrefix("nobackup" as never)).toThrow(/reserved/);
  });

  test("count as the tenant's own upload keys, a foreign tenant's do not", () => {
    expect(isOwnUploadKey("T1", "T1/a/b")).toBe(true);
    expect(isOwnUploadKey("T1", "nobackup/T1/a/b")).toBe(true);
    expect(isOwnUploadKey("T1", "nobackup/T2/a/b")).toBe(false);
    expect(isOwnUploadKey("T1", "T2/a/b")).toBe(false);
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
