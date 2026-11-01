import { patAuthRejectHttpStatus } from "@cosmicdrift/kumiko-framework/api";
import { frameworkErrorHttpStatus } from "@cosmicdrift/kumiko-framework/errors";
import { compareIds } from "../labels.ts";
import { codeSpan, table } from "./markdown.ts";
import type { ApiDocsTexts, DocumentedErrorCode } from "./texts/index.ts";

export type ErrorRow = { readonly code: DocumentedErrorCode; readonly status: number };

const statusTables: readonly Readonly<Record<string, number>>[] = [
  frameworkErrorHttpStatus,
  patAuthRejectHttpStatus,
];

function isDocumentedErrorCode(
  texts: Pick<ApiDocsTexts, "errorMeanings">,
  code: string,
): code is DocumentedErrorCode {
  return Object.hasOwn(texts.errorMeanings, code);
}

/** Every code the API can answer with: the framework table plus the token rejections,
 *  sorted by status then code. A code in both tables with the same status appears once. */
export function documentedErrorRows(
  texts: Pick<ApiDocsTexts, "errorMeanings">,
): readonly ErrorRow[] {
  const rows = new Map<string, ErrorRow>();
  for (const statuses of statusTables) {
    for (const [code, status] of Object.entries(statuses)) {
      if (isDocumentedErrorCode(texts, code)) rows.set(`${status}/${code}`, { code, status });
    }
  }
  return [...rows.values()].sort((a, b) => a.status - b.status || compareIds(a.code, b.code));
}

export function errorMeaningTable(texts: ApiDocsTexts, columns: string): string {
  const [code, status, meaning] = columns.split(" | ");
  return table(
    [code ?? "", status ?? "", meaning ?? ""],
    documentedErrorRows(texts).map((row) => [
      codeSpan(row.code),
      String(row.status),
      texts.errorMeanings[row.code],
    ]),
  );
}
