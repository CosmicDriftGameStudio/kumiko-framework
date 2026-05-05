import type { ZodError, ZodIssue } from "zod";
import type { FieldIssue } from "../dispatcher";

// Translates a ZodError into the same FieldIssue shape the server emits via
// its own zod-bridge (packages/framework/src/errors/zod-bridge.ts). The two
// bridges stay in sync on purpose: a field failing zod on the client reads
// identically to the same field failing zod on the server, so the UI's
// error-display path doesn't branch on provenance.
//
// Duplicated here (not imported) so ui-core remains free of
// @cosmicdrift/kumiko-framework — this package has to bundle for browsers and Expo,
// where a server-oriented framework dep would balloon bundle size and drag
// in Node-only modules (postgres, drizzle, bullmq) even if only types are
// consumed.
//
// Keep this list in sync with the server-side mirror — Zod version bumps
// tend to introduce new param keys, and the server's classes.test.ts is
// what catches them. A value added there should be added here too.
const ISSUE_PARAM_KEYS = [
  "minimum",
  "maximum",
  "expected",
  "received",
  "type",
  "inclusive",
  "exact",
  "keys",
  // Zod 4 additions
  "format",
  "divisor",
  "values",
  "pattern",
] as const;

// Flat FieldIssue list — same shape as server-side ValidationError.fields.
// The form-controller groups this by `path` for its snapshot's errors map.
export function zodErrorToFieldIssues(error: ZodError): FieldIssue[] {
  return error.issues.map<FieldIssue>((issue) => {
    const params = extractIssueParams(issue);
    return {
      // Empty-path issues (top-level object/array failures) use "(root)" so
      // the form-controller has a stable key to show "form itself is
      // malformed" errors under — matches what the server does.
      path: issue.path.map(String).join(".") || "(root)",
      code: issue.code,
      i18nKey: `errors.validation.${issue.code}`,
      ...(params && { params }),
    };
  });
}

function extractIssueParams(issue: ZodIssue): Readonly<Record<string, unknown>> | undefined {
  const out: Record<string, unknown> = {};
  const bag = issue as unknown as Record<string, unknown>; // @cast-boundary zod-issue
  for (const key of ISSUE_PARAM_KEYS) {
    if (bag[key] !== undefined) out[key] = bag[key];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// Groups a flat FieldIssue list into the `errors` map carried by a
// FormSnapshot. A field with multiple issues (e.g. both "required" and
// "min") keeps both — UIs that only render the first can pick the first
// element, those that want a full list have it.
export function groupIssuesByPath(
  issues: readonly FieldIssue[],
): Record<string, readonly FieldIssue[]> {
  const out: Record<string, FieldIssue[]> = {};
  for (const issue of issues) {
    const bucket = out[issue.path];
    if (bucket) bucket.push(issue);
    else out[issue.path] = [issue];
  }
  return out;
}
