import type { FieldIssue } from "@cosmicdrift/kumiko-framework/errors";
import { sanitizeDocumentHtml } from "../../template-resolver/index.ts";
import { effectiveBodyFormat } from "../constants.ts";

export const BODY_REJECTED_I18N_KEY = "managed-pages.errors.document.rejected";

export type PageBodyResult =
  | { readonly ok: true; readonly body: string | null }
  | { readonly ok: false; readonly issues: FieldIssue[] };

// The single write-time gate for document bodies (create, update, set, seed): a
// document body is stored as the sanitizer's rebuilt html, never as the raw input.
export function sanitizePageBody(body: string | null | undefined, format: unknown): PageBodyResult {
  if (effectiveBodyFormat(format) !== "document" || !body) return { ok: true, body: body ?? null };
  const result = sanitizeDocumentHtml(body);
  if (result.ok) return { ok: true, body: result.html };
  return {
    ok: false,
    issues: result.violations.map((violation) => ({
      path: "body",
      code: violation.code,
      i18nKey: BODY_REJECTED_I18N_KEY,
      params: { detail: violation.detail },
    })),
  };
}
