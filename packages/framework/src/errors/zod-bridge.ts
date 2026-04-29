import type { ZodError, ZodIssue } from "zod";
import { ValidationError, type ValidationFieldIssue } from "./classes";

// Zod issues carry a .code and sometimes issue-specific params (min, max, etc).
// We surface those under `params` so the client can render "must be at least N"
// without re-parsing the message.
//
// Keep this list in sync with the issue-code matrix in classes.test.ts — that
// test is what catches Zod upgrades introducing new param names.
const ISSUE_PARAM_KEYS = [
  "minimum",
  "maximum",
  "expected",
  "received",
  "type",
  "inclusive",
  "exact",
  "keys",
  // Zod 4 additions:
  "format", // invalid_format (email, url, uuid, regex, ...)
  "divisor", // not_multiple_of
  "values", // invalid_value (enum / literal)
  "pattern", // invalid_format with regex
] as const;

export function validationErrorFromZod(error: ZodError): ValidationError {
  const fields = error.issues.map<ValidationFieldIssue>((issue) => {
    const params = extractIssueParams(issue);
    return {
      path: issue.path.map(String).join(".") || "(root)",
      code: issue.code,
      i18nKey: `errors.validation.${issue.code}`,
      ...(params && { params }),
    };
  });
  return new ValidationError({ fields }, { cause: error });
}

function extractIssueParams(issue: ZodIssue): Readonly<Record<string, unknown>> | undefined {
  // ZodIssue is a discriminated union with variant-specific params (minimum,
  // maximum, expected, …); reading them generically requires widening since
  // the union members don't share an index signature.
  const out: Record<string, unknown> = {};
  const bag = issue as unknown as Record<string, unknown>; // @cast-boundary zod-issue
  for (const key of ISSUE_PARAM_KEYS) {
    if (bag[key] !== undefined) out[key] = bag[key];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
