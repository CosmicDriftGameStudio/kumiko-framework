import {
  RECORD_ENTITY_PATTERN,
  type SubjectId,
  subjectIdToKey,
} from "@cosmicdrift/kumiko-types/kms-adapter-types";
import { z } from "zod";
import type { TenantId } from "../engine/types/identifiers";

export * from "@cosmicdrift/kumiko-types/kms-adapter-types";

// The KMS error classes live here and not in kumiko-types (#1629): callers
// branch on them with `instanceof`, which needs a single copy of the class.

// `satisfies z.ZodType<SubjectId>` binds this to the TS type at compile time
// (fw#2801) — mint (subjectKeyForRecord) and shred (forget-subject) can no
// longer drift apart on which subjects are valid, the way #2809 happened.
export const subjectIdSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), userId: z.uuid() }),
  z.object({
    kind: z.literal("tenant"),
    // z.uuid() only proves string shape; TenantId is a nominal brand on top
    // of that, minted here right after validation (@cast-boundary).
    tenantId: z.uuid().transform((value) => value as TenantId),
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
