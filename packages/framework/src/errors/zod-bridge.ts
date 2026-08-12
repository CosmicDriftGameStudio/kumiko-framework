import type { ZodError, ZodIssue } from "zod";
import { ValidationError } from "./classes";
import type { FieldIssue } from "./field-issue";

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
  const fields = error.issues.map<FieldIssue>((issue) => {
    const params = extractIssueParams(issue);
    return {
      path: issue.path.map(String).join(".") || "(root)",
      code: issue.code,
      i18nKey: resolveI18nKey(issue),
      ...(params && { params }),
    };
  });
  return new ValidationError({ fields }, { cause: error });
}

// `code: "custom"` is zod's catch-all for every superRefine/refine check;
// left mechanical it'd collapse onto one generic key, so a superRefine can
// set `params.i18nKey` to override it. Keep in sync with the client mirror
// (packages/headless/src/form/zod-bridge.ts).
function resolveI18nKey(issue: ZodIssue): string {
  if (issue.code === "custom") {
    const override = issue.params?.["i18nKey"];
    if (typeof override === "string") return override;
  }
  return `errors.validation.${issue.code}`;
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
