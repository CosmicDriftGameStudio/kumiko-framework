import {
  type AppendMissingExtractEventDeps,
  type AppendMissingExtractEventOptions,
  type AppendMissingExtractEventResult,
  appendMissingDocumentExtractEvent,
} from "./append-missing-extract-event.ts";
import { listDocumentExtractSummaries } from "./document-extract-reader.ts";
import type { DocumentExtractMeta, IngestPage } from "./entity.ts";
import { writeDocumentExtractForLiveFileRef } from "./write-document-extract.ts";

export type CompleteDocumentExtractResult =
  | AppendMissingExtractEventResult
  | "skipped-file-ref-deleted";

// Providers deliver only pages and meta; the foundation writes the extract and its terminal event,
// and catches up the event of an earlier delivery that died after writing the extract.
export async function completeDocumentExtract(
  deps: AppendMissingExtractEventDeps,
  input: {
    readonly fileRefId: string;
    readonly storageKey: string;
    readonly pages: readonly IngestPage[];
    readonly meta: DocumentExtractMeta & Readonly<Record<string, unknown>>;
  },
  options: AppendMissingExtractEventOptions,
): Promise<CompleteDocumentExtractResult> {
  const written = await writeDocumentExtractForLiveFileRef({
    tenantDb: deps.tenantDb,
    actor: deps.actor,
    ...input,
  });
  if (written.kind === "written") {
    return appendMissingDocumentExtractEvent(
      deps,
      { id: written.documentExtractId, meta: input.meta },
      input.fileRefId,
      options,
    );
  }
  if (written.reason === "file_ref_deleted") return "skipped-file-ref-deleted";
  const existing = (await listDocumentExtractSummaries(deps.tenantDb, [input.fileRefId])).get(
    input.fileRefId,
  );
  // The extract was forgotten together with its fileRef in the meantime.
  if (!existing) return "skipped-file-ref-deleted";
  return appendMissingDocumentExtractEvent(deps, existing, input.fileRefId, options);
}
