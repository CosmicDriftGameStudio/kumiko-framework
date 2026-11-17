import { createEntityExecutor, type EntityDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { DOCUMENT_ENTITY, DOCUMENT_LINK_ENTITY } from "./constants.ts";

export function createDocumentExecutors(
  documentEntity: EntityDefinition,
  linkEntity: EntityDefinition,
) {
  return {
    document: createEntityExecutor({ ...documentEntity, name: DOCUMENT_ENTITY }).executor,
    link: createEntityExecutor({ ...linkEntity, name: DOCUMENT_LINK_ENTITY }).executor,
  };
}
export type DocumentExecutors = ReturnType<typeof createDocumentExecutors>;
