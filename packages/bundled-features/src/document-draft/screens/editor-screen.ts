import type { AccessRule } from "@cosmicdrift/kumiko-framework/engine";
import type { CustomScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { DOCUMENT_DRAFT_EDITOR_SCREEN_ID } from "../web/constants.ts";

// Opened with the draft id as entityId from the screen of the object the draft belongs to; the
// client plugin mounts the component under this id. Navigation is the app's business, so it is dormant.
export function createDocumentDraftEditorScreen(access: AccessRule): CustomScreenDefinition {
  return {
    id: DOCUMENT_DRAFT_EDITOR_SCREEN_ID,
    type: "custom",
    renderer: { react: { __component: DOCUMENT_DRAFT_EDITOR_SCREEN_ID } },
    description:
      "Edit one document draft: the text of the template copy with its placeholders and the deviations from the template beside it, then save, finalize to a PDF or discard.",
    access,
    dormant: true,
  };
}
