// @runtime client
//
// Lazy boundary: tiptap only loads when a "document" collection is rendered.
// Never import document-tiptap-editor or document-editor-extensions statically here.

import { TextareaContentEditor } from "@cosmicdrift/kumiko-renderer";
import { lazy, type ReactNode, Suspense } from "react";
import type { DocumentEditorProps } from "./document-toolbar-blocks.js";

const LazyDocumentTiptapEditor = lazy(() => import("./document-tiptap-editor.js"));

export function DocumentContentEditor(props: DocumentEditorProps): ReactNode {
  return (
    <Suspense
      fallback={
        <TextareaContentEditor
          id={props.id}
          value={props.value}
          onChange={props.onChange}
          variables={props.variables}
          readOnly={props.readOnly}
        />
      }
    >
      <LazyDocumentTiptapEditor {...props} />
    </Suspense>
  );
}
