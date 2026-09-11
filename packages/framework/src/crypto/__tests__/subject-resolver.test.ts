import { describe, expect, test } from "bun:test";
import { createEntity, createTextField } from "../../engine/factories";
import type { TenantId } from "../../engine/types/identifiers";
import {
  collectPiiSubjectFields,
  resolveEventSubject,
  resolveSubjectForField,
  SubjectResolutionError,
} from "../subject-resolver";

const userLikeEntity = createEntity({
  fields: {
    email: createTextField({ required: true, personal: "self", find: "none" }),
    role: createTextField(),
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
    authorId: createTextField({ required: true }),
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

  test("personal: { of } with a missing owner value → null, no throw (system-triggered event)", () => {
    const subject = resolveEventSubject(
      "note",
      { personal: { of: "authorId" } },
      { authorId: null },
      { tenantId: EVENT_TENANT, aggregateType: "note", aggregateId: UUID_B },
    );
    expect(subject).toBeNull();
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
