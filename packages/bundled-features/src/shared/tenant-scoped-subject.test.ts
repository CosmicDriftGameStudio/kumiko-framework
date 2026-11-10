import { describe, expect, test } from "bun:test";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { signRowBoundGrant } from "./row-bound-grant.ts";
import {
  parseTenantScopedSubject,
  peekTenantScopedSubject,
  tenantScopedSubject,
} from "./tenant-scoped-subject.ts";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const ROW_ID = "22222222-2222-4222-8222-222222222222";

describe("tenant-scoped-subject", () => {
  test("a built subject parses back to its parts", () => {
    const subject = tenantScopedSubject({ tenantId: TENANT_ID, rowId: ROW_ID });
    expect(parseTenantScopedSubject(subject)).toEqual({ tenantId: TENANT_ID, rowId: ROW_ID });
  });

  test("malformed subjects parse to null", () => {
    for (const subject of [
      "",
      ROW_ID,
      `${TENANT_ID}_not-a-uuid`,
      `not-a-uuid_${ROW_ID}`,
      `${TENANT_ID}_${ROW_ID}_extra`,
    ]) {
      expect(parseTenantScopedSubject(subject)).toBeNull();
    }
  });

  test("peek reads the subject of a signed grant and null for garbage", () => {
    const { token } = signRowBoundGrant({
      subject: tenantScopedSubject({ tenantId: TENANT_ID, rowId: ROW_ID }),
      purpose: "test-link",
      anchor: "1",
      ttlMinutes: 5,
      secret: "test-hmac-secret-32-bytes-minimum!!",
      now: Temporal.Now.instant(),
    });
    expect(peekTenantScopedSubject(token)).toEqual({ tenantId: TENANT_ID, rowId: ROW_ID });
    expect(peekTenantScopedSubject("garbage")).toBeNull();
  });
});
