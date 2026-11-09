import { describe, expect, test } from "bun:test";
import { encodeKeysetCursor } from "@cosmicdrift/kumiko-framework/db";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { openListCursor, sealListCursor } from "../list-cursor-seal.ts";

const SECRET = "list-cursor-seal-test-secret-0123456789";
const USER = createTestUser({ id: 1, tenantId: testTenantId(1), roles: ["TenantMember"] });
const OTHER_USER = createTestUser({ id: 2, tenantId: testTenantId(1), roles: ["TenantMember"] });
const OTHER_TENANT_USER = createTestUser({
  id: 1,
  tenantId: testTenantId(2),
  roles: ["TenantMember"],
});
const FOREIGN_ID = "0190f3a0-7b1c-7000-8000-000000000abc";
const BASE_CURSOR = encodeKeysetCursor("2026-01-01T00:00:00.000Z", FOREIGN_ID);

describe("signature :: list cursor seal", () => {
  test("opens what it sealed for the same user", async () => {
    const sealed = await sealListCursor(BASE_CURSOR, USER, SECRET);
    expect(await openListCursor(sealed, USER, SECRET)).toBe(BASE_CURSOR);
  });

  test("another user or another tenant cannot open it", async () => {
    const sealed = await sealListCursor(BASE_CURSOR, USER, SECRET);
    expect(await openListCursor(sealed, OTHER_USER, SECRET)).toBeNull();
    expect(await openListCursor(sealed, OTHER_TENANT_USER, SECRET)).toBeNull();
  });

  test("a manipulated token, a wrong secret and a plain cursor open to null", async () => {
    const sealed = await sealListCursor(BASE_CURSOR, USER, SECRET);
    const last = sealed.endsWith("A") ? "B" : "A";
    expect(await openListCursor(`${sealed.slice(0, -1)}${last}`, USER, SECRET)).toBeNull();
    expect(await openListCursor(sealed, USER, "another-secret-0123456789")).toBeNull();
    expect(await openListCursor(BASE_CURSOR, USER, SECRET)).toBeNull();
    expect(await openListCursor("", USER, SECRET)).toBeNull();
  });

  test("the sealed string shows neither the plain cursor nor the id", async () => {
    const sealed = await sealListCursor(BASE_CURSOR, USER, SECRET);
    expect(sealed).not.toContain(BASE_CURSOR);
    for (const part of sealed.split(".")) {
      const decoded = Buffer.from(part, "base64url").toString("latin1");
      expect(decoded).not.toContain(FOREIGN_ID);
    }
  });
});
