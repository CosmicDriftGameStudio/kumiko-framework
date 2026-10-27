import type { FieldIssue } from "@cosmicdrift/kumiko-framework/errors";
import { sanitizeDocumentHtml } from "../../template-resolver/index.ts";
import { effectiveBodyFormat } from "../constants.ts";

export const BODY_REJECTED_I18N_KEY = "managed-pages.errors.document.rejected";

// The single write-time check for document bodies (create, update, set).
export function pageBodyIssues(body: string | null | undefined, format: unknown): FieldIssue[] {
  if (effectiveBodyFormat(format) !== "document" || !body) return [];
  const result = sanitizeDocumentHtml(body);
  if (result.ok) return [];
  return result.violations.map((violation) => ({
    path: "body",
    code: violation.code,
    i18nKey: BODY_REJECTED_I18N_KEY,
    params: { detail: violation.detail },
  }));
}
