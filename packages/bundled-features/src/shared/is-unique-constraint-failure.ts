import type { WriteFailure } from "@cosmicdrift/kumiko-framework/errors";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";

// The executor reports a unique-index race as a WriteFailure(unique_violation)
// whose details name the violated constraint.
export function isUniqueConstraintFailure(failure: WriteFailure, constraint: string): boolean {
  return (
    propertyOf(failure.error, "code") === "unique_violation" &&
    propertyOf(propertyOf(failure.error, "details"), "constraintName") === constraint
  );
}
