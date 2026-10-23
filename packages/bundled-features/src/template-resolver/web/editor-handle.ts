import type { Editor } from "@tiptap/core";
import { useEffect, useRef } from "react";
import { isDocumentReferenceName, isDocumentResourceKey } from "./document-schema.ts";
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

// Reported from the commit, not tiptap's onCreate/onDestroy: tiptap destroys an unmounted editor on
// a later timer than it announces its replacement, so the old editor's late null would unregister
// the new handle after a remount. Effect cleanups of the unmounting component run before the new report.
export function useEditorHandleReport(
  editor: Editor | null,
  onEditorReady: ((handle: DocumentEditorHandle | null) => void) | undefined,
): void {
  const reportRef = useRef(onEditorReady);
  reportRef.current = onEditorReady;
  useEffect(() => {
    // skip: useEditor creates the instance in a later effect; the next run reports it
    if (editor === null) return;
    reportRef.current?.(createEditorHandle(editor));
    return () => reportRef.current?.(null);
  }, [editor]);
}
