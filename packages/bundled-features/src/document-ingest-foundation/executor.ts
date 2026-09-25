// Single shared instance — one createEventStoreExecutor per entity per
// process is the framework convention, reused by every write path outside
// the entity's own inline projection (tenant-destroy-hook, forget-extract-with-file-ref).

import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { documentExtractEntity, documentExtractsTable } from "./entity";

export const documentExtractExecutor = createEventStoreExecutor(
  documentExtractsTable,
  documentExtractEntity,
  { entityName: "document-extract" },
);
