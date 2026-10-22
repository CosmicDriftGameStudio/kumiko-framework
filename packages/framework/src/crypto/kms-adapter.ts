import {
  RECORD_ENTITY_PATTERN,
  type SubjectId,
  subjectIdToKey,
} from "@cosmicdrift/kumiko-types/kms-adapter-types";
import * as z from "zod";

export * from "@cosmicdrift/kumiko-types/kms-adapter-types";

// The KMS error classes live here and not in kumiko-types: callers
// branch on them with `instanceof`, which needs a single copy of the class.

// `satisfies z.ZodType<SubjectId>` plus the reverse check in subject-id-schema.test.ts bind this to the TS type
// at compile time — mint (subjectKeyForRecord) and shred (forget-subject) can no
// longer drift apart on which subjects are valid, the way it happened.
export const subjectIdSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), userId: z.uuid() }),
  z.object({
    kind: z.literal("tenant"),
    tenantId: z.uuid(),
  }),
  z.object({
    kind: z.literal("record"),
    entity: z.string().regex(RECORD_ENTITY_PATTERN),
    id: z.uuid(),
  }),
]) satisfies z.ZodType<SubjectId>;

export class KeyErasedError extends Error {
  constructor(public readonly subject: SubjectId) {
    super(`Subject key erased: ${subjectIdToKey(subject)}`);
    this.name = "KeyErasedError";
  }
}

export class KeyNotFoundError extends Error {
  constructor(public readonly subject: SubjectId) {
    super(`Subject key not found: ${subjectIdToKey(subject)}`);
    this.name = "KeyNotFoundError";
  }
}

export class KeyAlreadyExistsError extends Error {
  constructor(public readonly subject: SubjectId) {
    super(`Subject key already exists: ${subjectIdToKey(subject)}`);
    this.name = "KeyAlreadyExistsError";
  }
}
