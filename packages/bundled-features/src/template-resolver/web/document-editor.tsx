//
// Lazy boundary: tiptap only loads when a "document" collection is rendered.
// Never import document-tiptap-editor or document-editor-extensions statically here.

import { TextareaContentEditor } from "@cosmicdrift/kumiko-renderer";
import { createContext, lazy, type ReactNode, Suspense, useContext } from "react";
import type { DocumentEditorProps, DocumentToolbarBlock } from "./document-toolbar-blocks.ts";

const NO_BLOCKS: readonly DocumentToolbarBlock[] = [];

const LazyDocumentTiptapEditor = lazy(() => import("./document-tiptap-editor.tsx"));

// The editor registry only hands ContentEditorProps to an editor, so the
// collection's block set (mail vs. PDF) reaches it through this context. An
// explicit `blocks` prop still wins.
export const DocumentBlocksContext = createContext<readonly DocumentToolbarBlock[] | undefined>(
  undefined,
);

export function DocumentContentEditor(props: DocumentEditorProps): ReactNode {
  const contextBlocks = useContext(DocumentBlocksContext);
  const blocks = props.blocks ?? (props.formatting === "text" ? NO_BLOCKS : contextBlocks);
  const editorProps = { ...props, blocks };
  return (
    <Suspense
      // Read-only without chips: a textarea would insert {{name}} text and plaintext into a document body.
      fallback={
        <TextareaContentEditor
          id={props.id}
          value={props.value}
          onChange={props.onChange}
          variables={[]}
          readOnly
        />
      }
    >
      <LazyDocumentTiptapEditor {...editorProps} />
    </Suspense>
  );
}
