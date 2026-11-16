// Single shared instance — one createEventStoreExecutor per entity per
// process is the framework convention, reused by every write path outside
// the entity's own inline projection (tenant-destroy-hook, forget-extract-with-file-ref).

import { configuredPiiSubjectKms } from "@cosmicdrift/kumiko-framework/crypto";
import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { documentExtractEntity, documentExtractsTable } from "./entity.ts";
import { DOCUMENT_EXTRACT_AGGREGATE_TYPE } from "./events.ts";

export const documentExtractExecutor = createEventStoreExecutor(
  documentExtractsTable,
  documentExtractEntity,
  { entityName: DOCUMENT_EXTRACT_AGGREGATE_TYPE },
);

// forget() re-encrypts `previous` with the live record key, so the key is erased after it;
// without a mounted KMS nothing is encrypted per record and this is a no-op.
export async function eraseDocumentExtractKey(id: string, eraseReason: string): Promise<void> {
  await configuredPiiSubjectKms()?.eraseKey(
    { kind: "record", entity: DOCUMENT_EXTRACT_AGGREGATE_TYPE, id },
    { requestId: eraseReason, eraseReason },
  );
}
