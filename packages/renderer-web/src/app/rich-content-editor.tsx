// @runtime client
//
// "rich" contentFormat editor: WYSIWYG on tiptap. Public contract is the
// same four props every ContentEditorComponent gets — no tiptap type
// crosses this boundary. tiptap itself is dynamic-imported (TiptapEditor
// lives in ./tiptap-editor) so an app that never mounts a "rich" collection
// never pays for it; the fallback while the chunk loads is the same plain
// textarea #1794 uses for a missing editor, never a blank panel.

import { type ContentEditorProps, TextareaContentEditor } from "@cosmicdrift/kumiko-renderer";
import { lazy, type ReactNode, Suspense } from "react";

const TiptapEditor = lazy(() => import("./tiptap-editor"));

export function RichContentEditor(props: ContentEditorProps): ReactNode {
  return (
    <Suspense fallback={<TextareaContentEditor {...props} />}>
      <TiptapEditor {...props} />
    </Suspense>
  );
}
