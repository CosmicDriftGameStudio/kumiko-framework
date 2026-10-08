import { ConflictError } from "./classes.js";
import { FrameworkReasons } from "./reasons.js";

export function subjectErasedConflict(cause?: unknown): ConflictError {
  return new ConflictError({
    message: "the data subject was erased — its personal data can no longer be written",
    details: { reason: FrameworkReasons.subjectErased },
    ...(cause instanceof Error && { cause }),
  });
}
