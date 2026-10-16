import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { RENDERED_PDF_ENTITY_NAME, renderedPdfEntity, renderedPdfsTable } from "./entity.js";

export const renderedPdfExecutor = createEventStoreExecutor(renderedPdfsTable, renderedPdfEntity, {
  entityName: RENDERED_PDF_ENTITY_NAME,
});
