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

// Every zod code maps mechanically to `errors.validation.<code>` — except
// `code: "custom"`, which is zod's one-size-fits-all bucket for every
// `superRefine`/`refine` check in the codebase (e.g. schema-builder.ts's
// totalsMatch check). Left mechanical, ALL of them would collapse onto the
// same `errors.validation.custom` ("Invalid value.") key. A `superRefine`
// that needs its own key sets `params.i18nKey` on the issue; this is the one
// place that honors it. Keep in sync with the client-side mirror
// (packages/headless/src/form/zod-bridge.ts) — a superRefine can run on
// either side.
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
