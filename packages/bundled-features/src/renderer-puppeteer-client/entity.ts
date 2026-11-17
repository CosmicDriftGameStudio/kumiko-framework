import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createNumberField,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";

export const RENDERED_PDF_ENTITY_NAME = "rendered-pdf";

// Provenance of a stored PDF: which template version produced the file. The file
// name stays on the fileRef only, because it may carry personal data.
export const renderedPdfEntity = createEntity({
  table: "rendered_pdfs",
  fields: {
    fileRefId: createTextField({ required: true, personal: false, reason: "technical_reference" }),
    templateSlug: createTextField({ required: true, personal: false, reason: "system_metadata" }),
    locale: createTextField({ required: true, personal: false, reason: "system_metadata" }),
    templateId: createTextField({ required: true, personal: false, reason: "technical_reference" }),
    templateVersion: createNumberField({ required: true, integer: true }),
    templateScope: createTextField({ required: true, personal: false, reason: "system_metadata" }),
    layoutId: createTextField({ personal: false, reason: "technical_reference" }),
    layoutVersion: createNumberField({ integer: true }),
    pageCount: createNumberField({ required: true, integer: true }),
  },
});

export const renderedPdfsTable = buildEntityTable(RENDERED_PDF_ENTITY_NAME, renderedPdfEntity);
