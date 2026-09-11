// Mint/shred parity (fw#2801 security review): a record subject key is
// minted via subjectKeyForRecord (framework crypto) but shredded via a
// forget-subject request validated against subjectIdSchema (this feature).
// If the two ever disagreed on which entity names are valid, a field could
// encrypt cleanly and then never be reachable by forgetSubject — the
// "encrypted but not shreddable" state fw#2809 was built to prevent. This
// pins the invariant down without needing a DB.

import { describe, expect, test } from "bun:test";
import { subjectKeyForRecord } from "@cosmicdrift/kumiko-framework/crypto";
import { subjectIdSchema } from "../handlers/forget-subject.write";

const UUID_A = "6b2f4a0e-1c9d-4f3a-9d2e-00000000000a";

const VALID_ENTITY_NAMES = [
  "mail-account",
  "note-entry",
  "documentExtract",
  "a",
  "A1",
  "tenant_membership",
];

const INVALID_ENTITY_NAMES = ["v2.digest", "_internal", "3rd", "bad:name", ""];

describe("record subject mint/shred parity", () => {
  test("every entity name subjectKeyForRecord accepts, subjectIdSchema also accepts", () => {
    for (const entity of VALID_ENTITY_NAMES) {
      expect(() => subjectKeyForRecord(entity, UUID_A)).not.toThrow();
      const result = subjectIdSchema.safeParse({ kind: "record", entity, id: UUID_A });
      expect(result.success).toBe(true);
    }
  });

  test("every entity name subjectKeyForRecord rejects, subjectIdSchema also rejects", () => {
    for (const entity of INVALID_ENTITY_NAMES) {
      expect(() => subjectKeyForRecord(entity, UUID_A)).toThrow();
      const result = subjectIdSchema.safeParse({ kind: "record", entity, id: UUID_A });
      expect(result.success).toBe(false);
    }
  });
});
