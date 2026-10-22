import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import type { DataTableExport } from "../../data-table-view-types.ts";
import {
  CSRF_HEADER_NAME,
  LOCALE_HEADER_NAME,
  readActiveLocale,
  readCsrfToken,
} from "../../live/index.ts";

export type XlsxExportResult =
  | { readonly status: "ok"; readonly blob: Blob }
  | { readonly status: "too-many"; readonly maxRows: number | undefined }
  | { readonly status: "failed" };

const TOO_MANY_ROWS_HTTP_STATUS = 413;

async function readMaxRows(res: Response): Promise<number | undefined> {
  try {
    const body: unknown = await res.json();
    const error = isPlainObject(body) ? body["error"] : undefined;
    const details = isPlainObject(error) ? error["details"] : undefined;
    const maxRows = isPlainObject(details) ? details["maxRows"] : undefined;
    return typeof maxRows === "number" ? maxRows : undefined;
  } catch {
    return undefined;
  }
}

export async function requestXlsxExport(source: DataTableExport): Promise<XlsxExportResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const csrf = readCsrfToken();
  if (csrf !== undefined) headers[CSRF_HEADER_NAME] = csrf;
  const locale = readActiveLocale();
  if (locale !== undefined) headers[LOCALE_HEADER_NAME] = locale;
  try {
    const res = await fetch("/api/export/xlsx", {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({
        screen: source.screen,
        payload: source.payload,
        columns: source.columns,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    });
    if (res.ok) return { status: "ok", blob: await res.blob() };
    if (res.status === TOO_MANY_ROWS_HTTP_STATUS) {
      return { status: "too-many", maxRows: await readMaxRows(res) };
    }
    return { status: "failed" };
  } catch {
    return { status: "failed" };
  }
}
