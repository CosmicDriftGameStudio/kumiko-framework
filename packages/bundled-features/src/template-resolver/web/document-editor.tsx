// @runtime client
//
// Lazy boundary: tiptap only loads when a "document" collection is rendered.
// Never import document-tiptap-editor or document-editor-extensions statically here.

import { TextareaContentEditor } from "@cosmicdrift/kumiko-renderer";
import { createContext, lazy, type ReactNode, Suspense, useContext } from "react";
import type { DocumentEditorProps, DocumentToolbarBlock } from "./document-toolbar-blocks.js";

const LazyDocumentTiptapEditor = lazy(() => import("./document-tiptap-editor.js"));

// The editor registry only hands ContentEditorProps to an editor, so the
// collection's block set (mail vs. PDF) reaches it through this context. An
// explicit `blocks` prop still wins.
export const DocumentBlocksContext = createContext<readonly DocumentToolbarBlock[] | undefined>(
  undefined,
);

export function DocumentContentEditor(props: DocumentEditorProps): ReactNode {
  const contextBlocks = useContext(DocumentBlocksContext);
  const editorProps = props.blocks === undefined ? { ...props, blocks: contextBlocks } : props;
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
      <LazyDocumentTiptapEditor {...editorProps} />
    </Suspense>
  );
}
