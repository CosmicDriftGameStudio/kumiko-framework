import type { WriteFailure } from "@cosmicdrift/kumiko-framework/errors";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";

// A batch reports what went wrong per template instead of aborting: the first field issue's code
// for a validation failure, else the error's own reason or code.
export function failureReason(failure: WriteFailure): string {
  const { details } = failure.error;
  if (!isPlainObject(details)) return failure.error.code;
  const firstField = Array.isArray(details["fields"]) ? details["fields"][0] : undefined;
  if (isPlainObject(firstField) && typeof firstField["code"] === "string")
    return firstField["code"];
  return typeof details["reason"] === "string" ? details["reason"] : failure.error.code;
}
