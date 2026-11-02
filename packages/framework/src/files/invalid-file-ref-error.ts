import { ValidationError } from "../errors/index.ts";

// One error for every way a file field can name a ref the writer may not use (missing, foreign
// tenant, another record's file, someone else's pending upload, wrong claim), so the cause
// cannot be probed.
export function invalidFileRefError(fieldName: string): ValidationError {
  return new ValidationError({
    fields: [
      {
        path: fieldName,
        code: "invalid_element",
        i18nKey: "errors.validation.invalid_element",
      },
    ],
  });
}
