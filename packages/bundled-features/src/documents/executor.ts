import { createEntityExecutor, type EntityDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { DOCUMENT_ENTITY, DOCUMENT_LINK_ENTITY } from "./constants.ts";

export function createDocumentExecutors(
  documentEntity: EntityDefinition,
  linkEntity: EntityDefinition,
) {
  return {
    document: createEntityExecutor(DOCUMENT_ENTITY, documentEntity).executor,
    link: createEntityExecutor(DOCUMENT_LINK_ENTITY, linkEntity).executor,
  };
}
export type DocumentExecutors = ReturnType<typeof createDocumentExecutors>;
