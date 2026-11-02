import { PreviewPane, usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import {
  EditorWorkbench,
  PageSection,
  RailHint,
  RailRow,
  RailSection,
  Stack,
  type WorkbenchSave,
} from "@cosmicdrift/kumiko-renderer/web";
import type { ReactNode } from "react";
import { DocumentBlocksContext } from "./document-editor.tsx";
import { previewTargetOfCollectionKind, previewTargetOfKind } from "./preview-targets.ts";
import type { CollectionEditorContext } from "./use-collection-editor-context.ts";

export type ContentDetail = { readonly label: string; readonly value: string };

export type ContentWorkbenchProps = {
  readonly testId: string;
  readonly title: string;
  readonly editorContext: CollectionEditorContext;
  readonly content: string;
  readonly onContentChange: (value: string) => void;
  readonly disabled: boolean;
  /** Inputs above the content editor (title, slug). */
  readonly fields: ReactNode;
  /** Read-only facts about the entry, shown in the right rail of both modes. */
  readonly details: readonly ContentDetail[];
  readonly banners?: ReactNode;
  readonly save: WorkbenchSave;
};

// The text-block and collection-entry masks: title and content on the shared workbench, the
// preview renderer picked by the kind of what is edited (text-block previews as the web page it
// ends up in, collection entries as plain text unless their kind says otherwise).
export function ContentWorkbench({
  testId,
  title,
  editorContext,
  content,
  onContentChange,
  disabled,
  fields,
  details,
  banners,
  save,
}: ContentWorkbenchProps): ReactNode {
  const t = useTranslation();
  const { Field } = usePrimitives();
  const { ContentEditor, collection, contentFormat, documentBlocks, variableExamples, variables } =
    editorContext;
  const target =
    collection === undefined
      ? previewTargetOfKind["text-block"]
      : previewTargetOfCollectionKind(collection.kind);
  const editorId = `${testId}-content`;
  const exampleNames = Object.keys(variableExamples);
  const hasPlaceholders = variables.length > 0;

  const detailRows = (
    <RailSection title={t("template-resolver.editor.railDetails")}>
      {details.map((detail) => (
        <RailRow key={detail.label} label={detail.label} trailing={detail.value} />
      ))}
    </RailSection>
  );

  return (
    <EditorWorkbench
      testId={testId}
      title={title}
      info={{
        edit: t("template-resolver.editor.infoEdit"),
        preview: t(
          hasPlaceholders
            ? "template-resolver.editor.infoPreview"
            : "template-resolver.editor.infoPreviewPlain",
        ),
      }}
      banners={banners}
      edit={
        <div className="min-h-0 flex-1 overflow-y-auto" data-testid={`${testId}-scroll`}>
          <PageSection maxWidth="3xl">
            <Stack>
              {fields}
              <Field id={editorId} label={t("template-resolver.editor.contentLabel")}>
                <DocumentBlocksContext.Provider value={documentBlocks}>
                  <ContentEditor
                    id={editorId}
                    value={content}
                    onChange={onContentChange}
                    variables={variables}
                    readOnly={disabled}
                  />
                </DocumentBlocksContext.Provider>
              </Field>
            </Stack>
          </PageSection>
        </div>
      }
      preview={
        <PreviewPane
          target={target}
          content={content}
          editFormat={contentFormat ?? "plain"}
          variables={variableExamples}
          subject={{ kind: "body" }}
        />
      }
      rail={{
        edit: detailRows,
        preview: (
          <>
            {detailRows}
            {hasPlaceholders && (
              <RailSection title={t("template-resolver.editor.railExamples")}>
                {exampleNames.map((name) => (
                  <RailRow
                    key={name}
                    label={`{{${name}}}`}
                    trailing={variableExamples[name] ?? ""}
                  />
                ))}
              </RailSection>
            )}
          </>
        ),
        ...(hasPlaceholders && {
          left: (
            <RailSection title={t("template-resolver.editor.railPlaceholders")}>
              <RailHint>{t("template-resolver.editor.railPlaceholdersHint")}</RailHint>
              {variables.map((name) => (
                <RailRow key={name} label={`{{${name}}}`} />
              ))}
            </RailSection>
          ),
        }),
      }}
      save={save}
    />
  );
}
