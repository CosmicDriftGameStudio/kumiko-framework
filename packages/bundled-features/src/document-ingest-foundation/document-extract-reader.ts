import { PII_ERASED_SENTINEL } from "@cosmicdrift/kumiko-framework/crypto";
import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { documentExtractsTable, type IngestPage } from "./entity.ts";
import { documentExtractExecutor } from "./executor.ts";
import { readIngestPages } from "./pages.ts";
import { documentIngestProgressTable } from "./tables.ts";

export type DocumentExtractSummary = {
  readonly id: string;
  readonly fileRefId: string;
  readonly meta: Readonly<Record<string, unknown>> | null;
  readonly hasError: boolean;
};

export type LoadedDocumentExtract = DocumentExtractSummary & {
  readonly pages: readonly IngestPage[];
};

export type DocumentIngestProgress = {
  readonly pagesDone: number;
  readonly pagesTotal: number;
};

function toSummary(row: Record<string, unknown>): DocumentExtractSummary {
  const meta = isPlainObject(row["meta"]) ? row["meta"] : null;
  const error = meta?.["error"];
  return {
    id: String(row["id"]),
    fileRefId: String(row["fileRefId"]),
    meta,
    hasError: error !== undefined && error !== null,
  };
}

export async function listDocumentExtractSummaries(
  db: TenantDb,
  fileRefIds: readonly string[],
): Promise<ReadonlyMap<string, DocumentExtractSummary>> {
  const summaries = new Map<string, DocumentExtractSummary>();
  if (fileRefIds.length === 0) return summaries;
  const rows = await db.selectMany<Record<string, unknown>>(
    documentExtractsTable,
    { fileRefId: [...new Set(fileRefIds)] },
    {
      fields: ["id", "fileRefId", "meta", "insertedAt"],
      orderBy: { col: "insertedAt", direction: "desc" },
    },
  );
  for (const row of rows) {
    const summary = toSummary(row);
    if (!summaries.has(summary.fileRefId)) summaries.set(summary.fileRefId, summary);
  }
  return summaries;
}

export async function loadDocumentExtract(
  ctx: Pick<HandlerContext, "db" | "user">,
  fileRefId: string,
): Promise<LoadedDocumentExtract | null> {
  const summary = (await listDocumentExtractSummaries(ctx.db, [fileRefId])).get(fileRefId);
  if (!summary) return null;
  const detail = await documentExtractExecutor.detail({ id: summary.id }, ctx.user, ctx.db);
  // An erased record key shreds the text; it must not read as an empty document.
  if (!detail || detail["pages"] === PII_ERASED_SENTINEL) return null;
  return { ...summary, pages: readIngestPages(detail["pages"]) };
}

export async function loadDocumentIngestProgress(
  db: TenantDb,
  fileRefId: string,
): Promise<DocumentIngestProgress | null> {
  const rows = await db.selectMany<{ pagesDone: number; pagesTotal: number }>(
    documentIngestProgressTable,
    { fileRefId },
    { fields: ["pagesDone", "pagesTotal"], limit: 1 },
  );
  const row = rows[0];
  return row ? { pagesDone: row.pagesDone, pagesTotal: row.pagesTotal } : null;
}
