import { describe, expect, test } from "bun:test";
import { createEntity, createTextField } from "../../engine/factories";
import {
  collectPiiSubjectFields,
  resolveSubjectForField,
  SubjectResolutionError,
} from "../subject-resolver";

const userLikeEntity = createEntity({
  fields: {
    email: createTextField({ required: true, pii: true }),
    role: createTextField(),
  },
  table: "resolver_users",
  idType: "uuid",
});

const commentEntity = createEntity({
  fields: {
    body: createTextField({ userOwned: { ownerField: "authorId" } }),
    authorId: createTextField({ required: true }),
  },
  table: "resolver_comments",
});

const brandingEntity = createEntity({
  fields: {
    brandColor: createTextField({ tenantOwned: true }),
  },
  table: "resolver_branding",
});

const UUID_A = "6b2f4a0e-1c9d-4f3a-9d2e-00000000000a";
const UUID_B = "6b2f4a0e-1c9d-4f3a-9d2e-00000000000b";

describe("resolveSubjectForField", () => {
  test("pii: true → the entity row itself is the user subject", () => {
    const subject = resolveSubjectForField(userLikeEntity, "email", { id: UUID_A });
    expect(subject).toEqual({ kind: "user", userId: UUID_A });
  });

  test("pii self-subject stringifies serial ids", () => {
    const subject = resolveSubjectForField(userLikeEntity, "email", { id: 42 });
    expect(subject).toEqual({ kind: "user", userId: "42" });
  });

  test("userOwned → subject comes from the owner reference field", () => {
    const subject = resolveSubjectForField(commentEntity, "body", {
      id: UUID_A,
      authorId: UUID_B,
    });
    expect(subject).toEqual({ kind: "user", userId: UUID_B });
  });

  test("tenantOwned → subject from the row's tenantId column", () => {
    const subject = resolveSubjectForField(brandingEntity, "brandColor", {
      id: UUID_A,
      tenantId: UUID_B,
    });
    expect(subject).toEqual({ kind: "tenant", tenantId: UUID_B });
  });

  test("tenantOwned falls back to the write-time tenantId option", () => {
    const subject = resolveSubjectForField(
      brandingEntity,
      "brandColor",
      { id: UUID_A },
      { tenantId: UUID_B },
    );
    expect(subject).toEqual({ kind: "tenant", tenantId: UUID_B });
  });

  test("unannotated field → null (stays plaintext)", () => {
    expect(resolveSubjectForField(userLikeEntity, "role", { id: UUID_A })).toBeNull();
  });

  test("empty owner reference throws instead of silently falling back to plaintext", () => {
    expect(() => resolveSubjectForField(commentEntity, "body", { id: UUID_A })).toThrow(
      SubjectResolutionError,
    );
  });

  test("tenantOwned without any tenant scope throws", () => {
    expect(() => resolveSubjectForField(brandingEntity, "brandColor", { id: UUID_A })).toThrow(
      SubjectResolutionError,
    );
  });

  test("pii row without id throws", () => {
    expect(() => resolveSubjectForField(userLikeEntity, "email", {})).toThrow(
      SubjectResolutionError,
    );
  });

  test("unknown field name throws", () => {
    expect(() => resolveSubjectForField(userLikeEntity, "nope", { id: UUID_A })).toThrow(
      SubjectResolutionError,
    );
  });
});

describe("collectPiiSubjectFields", () => {
  test("collects exactly the annotated fields", () => {
    expect(collectPiiSubjectFields(userLikeEntity)).toEqual(["email"]);
    expect(collectPiiSubjectFields(commentEntity)).toEqual(["body"]);
    expect(collectPiiSubjectFields(brandingEntity)).toEqual(["brandColor"]);
  });
});
