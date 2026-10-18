import { describe, expect, test } from "bun:test";
import {
  createEntity,
  createFileField,
  createFilesField,
  createImageField,
  createImagesField,
  createTextField,
} from "../../engine/factories.ts";
import type { TenantId } from "../../engine/types/identifiers.ts";
import {
  collectPiiEncryptedFields,
  collectPiiSubjectFields,
  resolveEventSubject,
  resolveSubjectForField,
  SubjectResolutionError,
} from "../subject-resolver.ts";

const userLikeEntity = createEntity({
  fields: {
    email: createTextField({ required: true, personal: "self", find: "none" }),
    role: createTextField({ personal: false, reason: "test_fixture" }),
  },
  table: "resolver_users",
  idType: "uuid",
});

const commentEntity = createEntity({
  fields: {
    body: createTextField({
      personal: { of: "authorId" },
      find: "none",
    }),
    authorId: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
  table: "resolver_comments",
});

const brandingEntity = createEntity({
  fields: {
    brandColor: createTextField({
      personal: "tenant",
      find: "none",
    }),
  },
  table: "resolver_branding",
});

const UUID_A = "6b2f4a0e-1c9d-4f3a-9d2e-00000000000a";
const UUID_B = "6b2f4a0e-1c9d-4f3a-9d2e-00000000000b";
const ENTITY_NAME = "resolver-entity";

describe("resolveSubjectForField", () => {
  test("pii: true → the entity row itself is the user subject", () => {
    const subject = resolveSubjectForField(
      userLikeEntity,
      "email",
      { id: UUID_A },
      {
        entityName: ENTITY_NAME,
      },
    );
    expect(subject).toEqual({ kind: "user", userId: UUID_A });
  });

  test("pii self-subject stringifies serial ids", () => {
    const subject = resolveSubjectForField(
      userLikeEntity,
      "email",
      { id: 42 },
      {
        entityName: ENTITY_NAME,
      },
    );
    expect(subject).toEqual({ kind: "user", userId: "42" });
  });

  test("userOwned → subject comes from the owner reference field", () => {
    const subject = resolveSubjectForField(
      commentEntity,
      "body",
      { id: UUID_A, authorId: UUID_B },
      { entityName: ENTITY_NAME },
    );
    expect(subject).toEqual({ kind: "user", userId: UUID_B });
  });

  test("tenantOwned → subject from the row's tenantId column", () => {
    const subject = resolveSubjectForField(
      brandingEntity,
      "brandColor",
      { id: UUID_A, tenantId: UUID_B },
      { entityName: ENTITY_NAME },
    );
    expect(subject).toEqual({ kind: "tenant", tenantId: UUID_B });
  });

  test("tenantOwned falls back to the write-time tenantId option", () => {
    const subject = resolveSubjectForField(
      brandingEntity,
      "brandColor",
      { id: UUID_A },
      { tenantId: UUID_B, entityName: ENTITY_NAME },
    );
    expect(subject).toEqual({ kind: "tenant", tenantId: UUID_B });
  });

  test("unannotated field → null (stays plaintext)", () => {
    expect(
      resolveSubjectForField(userLikeEntity, "role", { id: UUID_A }, { entityName: ENTITY_NAME }),
    ).toBeNull();
  });

  test("empty owner reference throws instead of silently falling back to plaintext", () => {
    expect(() =>
      resolveSubjectForField(commentEntity, "body", { id: UUID_A }, { entityName: ENTITY_NAME }),
    ).toThrow(SubjectResolutionError);
  });

  describe("userOwned owner chain (fw#3654)", () => {
    const nullableOwnerEntity = createEntity({
      fields: {
        body: createTextField({ personal: { of: "authorId", whenAbsent: "tenant" }, find: "none" }),
        authorId: createTextField({ personal: "ref" }),
      },
      table: "resolver_nullable_owner",
    });
    const opts = { entityName: ENTITY_NAME };

    test("owner comes from the row", () => {
      expect(
        resolveSubjectForField(nullableOwnerEntity, "body", { authorId: UUID_A }, opts),
      ).toEqual({ kind: "user", userId: UUID_A });
    });

    test("ownerFallback supplies the owner when the row has none", () => {
      expect(
        resolveSubjectForField(
          nullableOwnerEntity,
          "body",
          { authorId: null },
          {
            ...opts,
            ownerFallback: { authorId: UUID_B },
          },
        ),
      ).toEqual({ kind: "user", userId: UUID_B });
    });

    test("the row owner wins over ownerFallback", () => {
      expect(
        resolveSubjectForField(
          nullableOwnerEntity,
          "body",
          { authorId: UUID_A },
          {
            ...opts,
            ownerFallback: { authorId: UUID_B },
          },
        ),
      ).toEqual({ kind: "user", userId: UUID_A });
    });

    test("whenAbsent tenant prefers the row's tenantId over the write-time tenantId", () => {
      expect(
        resolveSubjectForField(
          nullableOwnerEntity,
          "body",
          { authorId: null, tenantId: UUID_A },
          { ...opts, tenantId: UUID_B as TenantId },
        ),
      ).toEqual({ kind: "tenant", tenantId: UUID_A });
    });

    test('whenAbsent "self" keys an ownerless row on its own record subject', () => {
      const selfEntity = createEntity({
        fields: {
          body: createTextField({ personal: { of: "authorId", whenAbsent: "self" }, find: "none" }),
          authorId: createTextField({ personal: "ref" }),
        },
        table: "resolver_self_owner",
      });
      expect(
        resolveSubjectForField(selfEntity, "body", { id: UUID_B, authorId: null }, opts),
      ).toEqual({ kind: "record", entity: ENTITY_NAME, id: UUID_B });
      expect(
        resolveSubjectForField(selfEntity, "body", { id: UUID_B, authorId: UUID_A }, opts),
      ).toEqual({ kind: "user", userId: UUID_A });
      expect(() =>
        resolveSubjectForField(
          selfEntity,
          "body",
          { id: UUID_B, authorId: null },
          { ...opts, ignoreWhenAbsent: true },
        ),
      ).toThrow(SubjectResolutionError);
      expect(() => resolveSubjectForField(selfEntity, "body", { authorId: null }, opts)).toThrow(
        /no id to use as the record subject/,
      );
    });

    test("without whenAbsent an empty owner throws and names the fix", () => {
      expect(() => resolveSubjectForField(commentEntity, "body", { id: UUID_A }, opts)).toThrow(
        /declare \{ personal: \{ of: "authorId", whenAbsent: "tenant" \} \}/,
      );
    });

    test("ignoreWhenAbsent throws despite a declared whenAbsent", () => {
      expect(() =>
        resolveSubjectForField(
          nullableOwnerEntity,
          "body",
          { authorId: null, tenantId: UUID_A },
          { ...opts, ignoreWhenAbsent: true },
        ),
      ).toThrow(SubjectResolutionError);
    });
  });

  test("tenantOwned without any tenant scope throws", () => {
    expect(() =>
      resolveSubjectForField(
        brandingEntity,
        "brandColor",
        { id: UUID_A },
        { entityName: ENTITY_NAME },
      ),
    ).toThrow(SubjectResolutionError);
  });

  test("pii row without id throws", () => {
    expect(() =>
      resolveSubjectForField(userLikeEntity, "email", {}, { entityName: ENTITY_NAME }),
    ).toThrow(SubjectResolutionError);
  });

  test("unknown field name throws", () => {
    expect(() =>
      resolveSubjectForField(userLikeEntity, "nope", { id: UUID_A }, { entityName: ENTITY_NAME }),
    ).toThrow(SubjectResolutionError);
  });
});

describe("collectPiiSubjectFields", () => {
  test("collects exactly the annotated fields", () => {
    expect(collectPiiSubjectFields(userLikeEntity)).toEqual(["email"]);
    expect(collectPiiSubjectFields(commentEntity)).toEqual(["body"]);
    expect(collectPiiSubjectFields(brandingEntity)).toEqual(["brandColor"]);
  });
});

describe("collectPiiEncryptedFields", () => {
  const mediaEntity = createEntity({
    table: "resolver_media",
    fields: {
      authorId: createTextField({ personal: false, reason: "test_fixture" }),
      caption: createTextField({ personal: { of: "authorId" }, find: "none" }),
      attachment: createFileField({ personal: { of: "authorId" } }),
      selfie: createImageField({ personal: "self" }),
      attachments: createFilesField({ personal: { of: "authorId" } }),
      selfies: createImagesField({ personal: "self" }),
    },
  });

  test("file/image fields stay subject-annotated but are never encrypted", () => {
    expect(collectPiiSubjectFields(mediaEntity)).toEqual([
      "caption",
      "attachment",
      "selfie",
      "attachments",
      "selfies",
    ]);
    expect(collectPiiEncryptedFields(mediaEntity)).toEqual(["caption"]);
  });

  test("equals the subject fields for entities without file fields", () => {
    expect(collectPiiEncryptedFields(userLikeEntity)).toEqual(["email"]);
  });
});

const EVENT_TENANT = "6b2f4a0e-1c9d-4f3a-9d2e-0000000000e1" as TenantId;

describe("resolveEventSubject (fw#2801)", () => {
  test("personal: { of } → user subject from the named payload field", () => {
    const subject = resolveEventSubject(
      "note",
      { personal: { of: "authorId" } },
      { authorId: UUID_A },
      { tenantId: EVENT_TENANT, aggregateType: "note", aggregateId: UUID_B },
    );
    expect(subject).toEqual({ kind: "user", userId: UUID_A });
  });

  test("personal: { of } with a missing owner value and no whenAbsent → throws (fw#2776)", () => {
    expect(() =>
      resolveEventSubject(
        "note",
        { personal: { of: "authorId" } },
        { authorId: null },
        { tenantId: EVENT_TENANT, aggregateType: "note", aggregateId: UUID_B },
      ),
    ).toThrow(/carries no id and the event declares no whenAbsent fallback/);
  });

  test('personal: { of, whenAbsent: "plaintext" } with a missing owner → null (fw#2776)', () => {
    const subject = resolveEventSubject(
      "note",
      { personal: { of: "authorId", whenAbsent: "plaintext" } },
      { authorId: null },
      { tenantId: EVENT_TENANT, aggregateType: "note", aggregateId: UUID_B },
    );
    expect(subject).toBeNull();
  });

  test('personal: { of, whenAbsent: "tenant" } with a missing owner → envelope tenant (fw#2776)', () => {
    const subject = resolveEventSubject(
      "note",
      { personal: { of: "authorId", whenAbsent: "tenant" } },
      { authorId: null },
      { tenantId: EVENT_TENANT, aggregateType: "note", aggregateId: UUID_B },
    );
    expect(subject).toEqual({ kind: "tenant", tenantId: EVENT_TENANT });
  });

  test('personal: { of, whenAbsent: "self" } with a missing owner → record subject of the envelope aggregate', () => {
    const subject = resolveEventSubject(
      "note",
      { personal: { of: "authorId", whenAbsent: "self" } },
      { authorId: null },
      { tenantId: EVENT_TENANT, aggregateType: "note", aggregateId: UUID_B },
    );
    expect(subject).toEqual({ kind: "record", entity: "note", id: UUID_B });
  });

  test('personal: { of, whenAbsent: "self" } with an owner → user subject', () => {
    const subject = resolveEventSubject(
      "note",
      { personal: { of: "authorId", whenAbsent: "self" } },
      { authorId: UUID_A },
      { tenantId: EVENT_TENANT, aggregateType: "note", aggregateId: UUID_B },
    );
    expect(subject).toEqual({ kind: "user", userId: UUID_A });
  });

  test('personal: { of, whenAbsent: "self" } rejects an aggregateType that is no shreddable record entity', () => {
    expect(() =>
      resolveEventSubject(
        "note",
        { personal: { of: "authorId", whenAbsent: "self" } },
        { authorId: null },
        { tenantId: EVENT_TENANT, aggregateType: "not a/valid type", aggregateId: UUID_B },
      ),
    ).toThrow(/does not match/);
  });

  test('personal: "tenant" → subject from the envelope tenantId', () => {
    const subject = resolveEventSubject(
      "note",
      { personal: "tenant" },
      {},
      { tenantId: EVENT_TENANT, aggregateType: "note", aggregateId: UUID_B },
    );
    expect(subject).toEqual({ kind: "tenant", tenantId: EVENT_TENANT });
  });

  test('personal: "self" → record subject from the envelope aggregateType/aggregateId', () => {
    const subject = resolveEventSubject(
      "note",
      { personal: "self" },
      {},
      { tenantId: EVENT_TENANT, aggregateType: "note", aggregateId: UUID_B },
    );
    expect(subject).toEqual({ kind: "record", entity: "note", id: UUID_B });
  });

  test('personal: "tenant" with an empty envelope tenantId throws and names the pii field, not "tenant"', () => {
    expect(() =>
      resolveEventSubject(
        "note",
        { personal: "tenant" },
        {},
        { tenantId: "" as TenantId, aggregateType: "note", aggregateId: UUID_B },
      ),
    ).toThrow(/field "note"/);
  });

  test('personal: "self" with an empty envelope aggregateId throws and names the pii field, not "self"', () => {
    expect(() =>
      resolveEventSubject(
        "note",
        { personal: "self" },
        {},
        { tenantId: EVENT_TENANT, aggregateType: "note", aggregateId: "" },
      ),
    ).toThrow(/field "note"/);
  });

  test('personal: "self" with an aggregateType that violates the record-entity pattern throws — mint must never outrun shred (fw#2801)', () => {
    expect(() =>
      resolveEventSubject(
        "note",
        { personal: "self" },
        {},
        { tenantId: EVENT_TENANT, aggregateType: "v2.digest", aggregateId: UUID_B },
      ),
    ).toThrow(/field "note".*v2\.digest/s);
  });

  test("legacy subjectField normalizes to the same user subject as personal: { of }", () => {
    const subject = resolveEventSubject(
      "note",
      { subjectField: "authorId" },
      { authorId: UUID_A },
      { tenantId: EVENT_TENANT, aggregateType: "note", aggregateId: UUID_B },
    );
    expect(subject).toEqual({ kind: "user", userId: UUID_A });
  });
});
