import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { ConflictError } from "./classes.ts";
import { FrameworkReasons } from "./reasons.ts";

export function subjectErasedConflict(cause?: unknown): ConflictError {
  return new ConflictError({
    message: "the data subject was erased — its personal data can no longer be written",
    details: { reason: FrameworkReasons.subjectErased },
    ...(cause instanceof Error && { cause }),
  });
}

export function isSubjectErasedConflict(e: unknown): e is ConflictError {
  return (
    e instanceof ConflictError &&
    isPlainObject(e.details) &&
    e.details["reason"] === FrameworkReasons.subjectErased
  );
}
