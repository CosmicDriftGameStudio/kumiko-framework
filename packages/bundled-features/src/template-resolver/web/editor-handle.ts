// @runtime client
import type { Editor } from "@tiptap/core";
import { isDocumentReferenceName, isDocumentResourceKey } from "../document-schema.ts";
import type { DocumentEditorHandle } from "./document-toolbar-blocks.ts";

export function createEditorHandle(editor: Editor): DocumentEditorHandle {
  return {
    insertPlaceholder: (name) => {
      // skip: an invalid variable name is not insertable
      if (!isDocumentReferenceName(name)) return;
      editor.chain().focus().insertContent({ type: "variable", attrs: { name } }).run();
    },
    insertResource: (key, alt) => {
      // skip: an invalid resource key is not insertable
      if (!isDocumentResourceKey(key)) return;
      editor
        .chain()
        .focus()
        .insertContent({ type: "resource", attrs: { resource: key, alt: alt ?? null } })
        .run();
    },
    focus: () => {
      editor.commands.focus();
    },
  };
}
