import { ContentPreview, usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useId, useState } from "react";
import { DocumentBlocksContext } from "./document-editor.tsx";
import type { CollectionEditorContext } from "./use-collection-editor-context.ts";

export type ContentFieldProps = {
  readonly editorContext: CollectionEditorContext;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled: boolean;
};

// The content input shared by the edit and create forms: the collection's editor
// plus a toggle to its preview with the example variables substituted.
export function ContentField({
  editorContext,
  value,
  onChange,
  disabled,
}: ContentFieldProps): ReactNode {
  const { Field, Button } = usePrimitives();
  const t = useTranslation();
  const contentEditorId = useId();
  const [previewing, setPreviewing] = useState(false);
  const { ContentEditor, contentFormat, documentBlocks, variableExamples, variables } =
    editorContext;
  return (
    <Field
      id={contentEditorId}
      label={t("template-resolver.editor.contentLabel")}
      labelAppendix={
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setPreviewing((p) => !p)}
        >
          {previewing ? t("kumiko.contentEditor.editMode") : t("kumiko.contentEditor.preview")}
        </Button>
      }
    >
      {previewing ? (
        <ContentPreview
          content={value}
          variables={variableExamples}
          contentFormat={contentFormat}
        />
      ) : (
        <DocumentBlocksContext.Provider value={documentBlocks}>
          <ContentEditor
            id={contentEditorId}
            value={value}
            onChange={onChange}
            variables={variables}
            readOnly={disabled}
          />
        </DocumentBlocksContext.Provider>
      )}
    </Field>
  );
}
