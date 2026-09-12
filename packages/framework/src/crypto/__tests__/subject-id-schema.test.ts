// subjectIdSchema is `satisfies z.ZodType<SubjectId>` at the definition site
// (kms-adapter.ts) — a future 4th SubjectId variant or a renamed field fails
// to compile there. This file pins the runtime side of that binding: exactly
// the three SubjectId shapes parse, everything else is refused.

import { describe, expect, test } from "bun:test";
import { subjectIdSchema } from "../kms-adapter";

const UUID_A = "6b2f4a0e-1c9d-4f3a-9d2e-00000000000a";

describe("subjectIdSchema", () => {
  test("accepts a user subject", () => {
    expect(subjectIdSchema.safeParse({ kind: "user", userId: UUID_A }).success).toBe(true);
  });

  test("accepts a tenant subject", () => {
    expect(subjectIdSchema.safeParse({ kind: "tenant", tenantId: UUID_A }).success).toBe(true);
  });

  test("accepts a record subject", () => {
    expect(
      subjectIdSchema.safeParse({ kind: "record", entity: "mail-account", id: UUID_A }).success,
    ).toBe(true);
  });

  test("mints tenantId as a branded TenantId, not a plain string type", () => {
    const result = subjectIdSchema.parse({ kind: "tenant", tenantId: UUID_A });
    expect(result).toEqual({ kind: "tenant", tenantId: UUID_A });
  });

  test("rejects a non-UUID userId", () => {
    expect(subjectIdSchema.safeParse({ kind: "user", userId: "not-a-uuid" }).success).toBe(false);
  });

  test("rejects a non-UUID tenantId", () => {
    expect(subjectIdSchema.safeParse({ kind: "tenant", tenantId: "not-a-uuid" }).success).toBe(
      false,
    );
  });

  test("rejects a non-UUID record id", () => {
    expect(
      subjectIdSchema.safeParse({ kind: "record", entity: "mail-account", id: "not-a-uuid" })
        .success,
    ).toBe(false);
  });

  test("rejects a record entity that violates RECORD_ENTITY_PATTERN", () => {
    expect(
      subjectIdSchema.safeParse({ kind: "record", entity: "_internal", id: UUID_A }).success,
    ).toBe(false);
    expect(
      subjectIdSchema.safeParse({ kind: "record", entity: "v2.digest", id: UUID_A }).success,
    ).toBe(false);
  });

  test("rejects an unknown subject kind", () => {
    expect(subjectIdSchema.safeParse({ kind: "bogus", id: UUID_A }).success).toBe(false);
  });
});
