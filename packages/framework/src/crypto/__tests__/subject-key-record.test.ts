import { describe, expect, test } from "bun:test";
import { createEntity, createTextField } from "../../engine/factories";
import { InMemoryKmsAdapter } from "../in-memory-kms-adapter";
import {
  type KmsContext,
  subjectIdFromKey,
  subjectIdToKey,
  subjectKeyForRecord,
} from "../kms-adapter";
import {
  decryptPiiFieldValues,
  encryptPiiFieldValues,
  isPiiCiphertext,
  PII_CIPHERTEXT_PREFIX,
} from "../pii-field-encryption";
import {
  collectPiiSubjectFields,
  resolveSubjectForField,
  SubjectResolutionError,
} from "../subject-resolver";

const UUID_A = "6b2f4a0e-1c9d-4f3a-9d2e-00000000000a";
const KMS_CTX: KmsContext = { requestId: "test" };

const recordEntity = createEntity({
  fields: {
    body: createTextField({ required: true, personal: { of: "id" }, find: "none" }),
  },
  table: "subject_key_record_probe",
});

describe("record subject key round-trip", () => {
  test("subjectIdToKey serializes record:<entity>:<id>", () => {
    expect(subjectIdToKey({ kind: "record", entity: "notesHistory", id: UUID_A })).toBe(
      `record:notesHistory:${UUID_A}`,
    );
  });

  test("subjectIdFromKey round-trips all three kinds", () => {
    const cases = [
      { kind: "user" as const, userId: UUID_A },
      { kind: "tenant" as const, tenantId: UUID_A },
      { kind: "record" as const, entity: "notesHistory", id: UUID_A },
    ];
    for (const subject of cases) {
      expect(subjectIdFromKey(subjectIdToKey(subject))).toEqual(subject);
    }
  });

  test("a record key never collides with a user key and vice versa", () => {
    expect(subjectIdFromKey("record:a:b")).toEqual({ kind: "record", entity: "a", id: "b" });
    expect(subjectIdFromKey("user:record:a:b")).toEqual({ kind: "user", userId: "record:a:b" });
  });

  test('subjectKeyForRecord rejects an entity name containing ":"', () => {
    expect(() => subjectKeyForRecord("bad:name", UUID_A)).toThrow();
  });

  test("subjectKeyForRecord rejects entity names that subjectIdSchema (forget-subject) could never shred (fw#2801)", () => {
    expect(() => subjectKeyForRecord("v2.digest", UUID_A)).toThrow();
    expect(() => subjectKeyForRecord("_internal", UUID_A)).toThrow();
    expect(() => subjectKeyForRecord("3rd", UUID_A)).toThrow();
  });

  test("subjectKeyForRecord accepts a kebab-case registry entity name", () => {
    expect(subjectKeyForRecord("mail-account", UUID_A)).toBe(`record:mail-account:${UUID_A}`);
  });

  test("ciphertext round-trip for a record-owned field", async () => {
    const kms = new InMemoryKmsAdapter();
    const fields = collectPiiSubjectFields(recordEntity);
    const row = { id: UUID_A, body: "free-text support note" };

    const stored = await encryptPiiFieldValues(row, recordEntity, fields, kms, KMS_CTX, {
      entityName: "recordProbe",
    });
    expect(isPiiCiphertext(stored["body"])).toBe(true);
    expect(String(stored["body"])).toStartWith(
      `${PII_CIPHERTEXT_PREFIX}record:recordProbe:${UUID_A}:`,
    );

    const read = await decryptPiiFieldValues(stored, fields, kms, KMS_CTX);
    expect(read["body"]).toBe("free-text support note");
  });
});

describe("resolveSubjectForField: recordOwned fail-closed", () => {
  test("recordOwned field without opts.entityName throws", () => {
    expect(() =>
      resolveSubjectForField(recordEntity, "body", { id: UUID_A }, { entityName: "" }),
    ).toThrow(SubjectResolutionError);
  });

  test("recordOwned field with row missing id throws", () => {
    expect(() =>
      resolveSubjectForField(recordEntity, "body", {}, { entityName: "recordProbe" }),
    ).toThrow(SubjectResolutionError);
  });

  test("recordOwned field resolves to the record subject", () => {
    const subject = resolveSubjectForField(
      recordEntity,
      "body",
      { id: UUID_A },
      { entityName: "recordProbe" },
    );
    expect(subject).toEqual({ kind: "record", entity: "recordProbe", id: UUID_A });
  });
});
