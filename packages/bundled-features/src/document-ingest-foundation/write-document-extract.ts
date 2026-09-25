// Providers write documentExtract rows themselves (their own executor
// call on ctx.db) rather than through a request/response API, so this is
// the one place that write must go through to stay race-safe against a
// concurrent fileRef delete/forget — see forget-extract-with-file-ref.ts.

import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import type { DocumentExtractMeta, IngestPage } from "./entity";
import { documentExtractExecutor } from "./executor";
import { isFileRefLive } from "./file-ref-liveness";
import { writeIngestPages } from "./pages";

export type DocumentExtractWriteResult =
  | { readonly kind: "written"; readonly documentExtractId: string }
  | { readonly kind: "skipped"; readonly reason: "file_ref_deleted" };

export async function writeDocumentExtractForLiveFileRef(input: {
  readonly tenantDb: TenantDb;
  readonly actor: SessionUser;
  readonly fileRefId: string;
  readonly storageKey: string;
  readonly pages: readonly IngestPage[];
  readonly meta: DocumentExtractMeta & Readonly<Record<string, unknown>>;
}): Promise<DocumentExtractWriteResult> {
  // Early-skip optimization only — a fileRef deleted/forgotten right after
  // this check still gets caught by forget-extract-with-file-ref.ts's
  // documentExtract.created handler, which is the actual race-safety guarantee.
  if (!(await isFileRefLive(input.tenantDb, input.fileRefId))) {
    return { kind: "skipped", reason: "file_ref_deleted" };
  }
  const result = await documentExtractExecutor.create(
    {
      fileRefId: input.fileRefId,
      storageKey: input.storageKey,
      pages: writeIngestPages(input.pages),
      meta: input.meta,
    },
    input.actor,
    input.tenantDb,
  );
  if (!result.isSuccess) {
    throw new InternalError({
      message: `document-ingest-foundation: failed to write documentExtract for fileRef ${input.fileRefId}: ${result.error.message}`,
    });
  }
  return { kind: "written", documentExtractId: String(result.data.id) };
}
