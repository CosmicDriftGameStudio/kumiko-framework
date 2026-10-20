import type { FieldIssue } from "./headless/index.ts";

const INVALID_FORMAT_KEY = "errors.validation.invalid_format";

type TranslateFn = (key: string, params?: Readonly<Record<string, unknown>>) => string;

// Zod reports every string-format failure under one code; the per-format key
// (…invalid_format.email) carries a worked example, the generic key stays the
// fallback for formats without one.
export function fieldIssueText(t: TranslateFn, issue: FieldIssue): string {
  const format = issue.params?.["format"];
  if (issue.i18nKey === INVALID_FORMAT_KEY && typeof format === "string") {
    const formatKey = `${INVALID_FORMAT_KEY}.${format}`;
    const text = t(formatKey, issue.params);
    if (text !== formatKey) return text;
  }
  return t(issue.i18nKey, issue.params);
}
