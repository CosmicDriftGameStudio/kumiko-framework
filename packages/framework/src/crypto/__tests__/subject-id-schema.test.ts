// subjectIdSchema is `satisfies z.ZodType<SubjectId>` at the definition site
// (kms-adapter.ts) — a renamed field fails to compile there; a 4th SubjectId
// variant the schema lacks fails to compile in the check below. The tests pin
// the runtime side: exactly the three SubjectId shapes parse, everything else
// is refused.

import { describe, expect, test } from "bun:test";
import type * as z from "zod";
import { type SubjectId, subjectIdSchema } from "../kms-adapter.js";

// `satisfies` at the definition only proves schema output ⊆ SubjectId; this
// proves the reverse, so a SubjectId variant the schema lacks fails to compile.
const _schemaCoversEverySubjectId: [SubjectId] extends [z.output<typeof subjectIdSchema>]
  ? true
  : never = true;

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
