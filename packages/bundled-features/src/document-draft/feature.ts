import {
  defineFeature,
  EXT_USER_DATA,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { createDocumentDraftEntity, createDocumentDraftExecutor } from "./entity.ts";
import { createBlocksQuery } from "./handlers/blocks.query.ts";
import { createBySubjectQuery } from "./handlers/by-subject.query.ts";
import { createCreateHandler } from "./handlers/create.write.ts";
import { createDiscardHandler } from "./handlers/discard.write.ts";
import { createFinalizeHandler } from "./handlers/finalize.write.ts";
import { createPatchHandler } from "./handlers/patch.write.ts";
import { createReviseHandler } from "./handlers/revise.write.ts";
import { createSaveHandler } from "./handlers/save.write.ts";
import { DOCUMENT_DRAFT_I18N } from "./i18n.ts";
import { DEFAULT_DOCUMENT_DRAFT_ACCESS } from "./lib.ts";
import type { DocumentDraftOptions } from "./options.ts";
import { createDocumentDraftEditorScreen } from "./screens/editor-screen.ts";
import { DOCUMENT_DRAFT_ENTITY, DOCUMENT_DRAFT_FEATURE } from "./web/constants.ts";

export function createDocumentDraftFeature(
  opts: DocumentDraftOptions,
): FeatureDefinition {
  const access = opts.access ?? DEFAULT_DOCUMENT_DRAFT_ACCESS;
  const entity = createDocumentDraftEntity(opts.retention, opts.subjectTypes);
  const documentDraftExecutor = createDocumentDraftExecutor(opts.subjectTypes);

  return defineFeature(DOCUMENT_DRAFT_FEATURE, (r) => {
    r.describe(
      "Document drafts: one editable copy of a PDF document template per object (for example a lease contract). A draft is created from a template or one of its variants with the values for its placeholders, changed with the structured operations of template patch-draft or the editor, and finalized to a stored PDF through the print client; the template stays unchanged. Revise reopens a finalized draft. Body, variables and the last change are personal data of the draft, which is its own crypto-shredding subject.",
    );
    r.uiHints({ displayLabel: "Document drafts", category: "data", recommended: false });
    r.requires({
      features: ["files", "template-resolver", "user-data-rights", "renderer-puppeteer-client"],
    });
    r.translations({ keys: DOCUMENT_DRAFT_I18N });

    r.entity(entity);

    r.writeHandler(createCreateHandler(access, documentDraftExecutor, opts.subjectTypes));
    r.writeHandler(createPatchHandler(access, documentDraftExecutor));
    r.writeHandler(createSaveHandler(access, documentDraftExecutor));
    r.writeHandler(createFinalizeHandler(access, documentDraftExecutor));
    r.writeHandler(createReviseHandler(access, documentDraftExecutor));
    r.writeHandler(createDiscardHandler(access, documentDraftExecutor));
    r.queryHandler(createBlocksQuery(access, documentDraftExecutor, opts.subjectScreens));
    r.queryHandler(createBySubjectQuery(access, documentDraftExecutor));
    r.screen(createDocumentDraftEditorScreen(access));

    // A draft belongs to the object it was made for, not to the acting user: the app erases it
    // with forgetDocumentDraftsOfSubject when that object is erased, so the user pipeline has nothing to do.
    r.applyExtension({ name: EXT_USER_DATA, entity: DOCUMENT_DRAFT_ENTITY, export: async () => null,
      delete: async () => {} });
  });
}
