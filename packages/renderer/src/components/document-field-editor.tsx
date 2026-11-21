import { type ReactNode, useEffect, useState } from "react";
import {
  TextareaContentEditor,
  useContentEditor,
  useHasContentEditor,
} from "../app/content-editors.tsx";
import { documentHtmlToText, textToDocumentHtml } from "./document-text.ts";

type DocumentFieldEditorProps = {
  readonly id: string;
  readonly value: string;
  readonly readOnly: boolean;
  readonly onChange: (value: unknown) => void;
};

// Without a registered document editor (React Native, apps without the tiptap client) the
// field still holds HTML: the textarea edits the text and reports it as escaped paragraphs.
// The local text keeps trailing blanks and newlines that the HTML round trip would trim.
function DocumentTextareaFallback({
  id,
  value,
  readOnly,
  onChange,
}: DocumentFieldEditorProps): ReactNode {
  const [text, setText] = useState(() => documentHtmlToText(value));
  useEffect(() => {
    if (value !== textToDocumentHtml(text)) setText(documentHtmlToText(value));
  }, [value, text]);
  return (
    <TextareaContentEditor
      id={id}
      value={text}
      readOnly={readOnly}
      variables={[]}
      onChange={(next) => {
        setText(next);
        onChange(textToDocumentHtml(next));
      }}
    />
  );
}

export function DocumentFieldEditor(props: DocumentFieldEditorProps): ReactNode {
  const hasDocumentEditor = useHasContentEditor("document");
  const Editor = useContentEditor("document");
  if (!hasDocumentEditor) return <DocumentTextareaFallback {...props} />;
  return (
    <Editor
      id={props.id}
      value={props.value}
      readOnly={props.readOnly}
      variables={[]}
      formatting="text"
      // An emptied tiptap document is "<p></p>"; required and empty checks need "".
      onChange={(html) => props.onChange(documentHtmlToText(html) === "" ? "" : html)}
    />
  );
}
