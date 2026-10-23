import { useEditor, useEditorState } from "@tiptap/react";
import { useMemo, useState } from "react";
import { createDocumentEditorExtensions } from "./document-editor-extensions.ts";
import { activeStateOf, type PanelKind, previewsKey } from "./document-tiptap-helpers.ts";
import type { DocumentEditorProps, DocumentResourcePreview } from "./document-toolbar-blocks.ts";
import { useEditorHandleReport } from "./editor-handle.ts";
import { useStableByKey } from "./use-stable-by-key.ts";

type Translate = (key: string, params?: Readonly<Record<string, unknown>>) => string;

export function documentEditorLabels(t: Translate) {
  return {
    placeholderLabel: t("template-resolver.documentEditor.placeholder"),
    imageLabel: t("template-resolver.documentEditor.image"),
    imageBlockLabel: t("template-resolver.documentEditor.imageBlock"),
    pageBreakLabel: t("template-resolver.documentEditor.pageBreak"),
    buttonLabel: t("template-resolver.documentEditor.button"),
    stepsLabel: t("template-resolver.documentEditor.steps"),
    imagesLabel: t("template-resolver.documentEditor.images"),
  };
}

export type DocumentEditorLabels = ReturnType<typeof documentEditorLabels>;

function useDocumentExtensions(input: {
  readonly labels: DocumentEditorLabels;
  readonly canvas: boolean;
  readonly variableLabels: Readonly<Record<string, string>>;
  readonly systemVariables: readonly string[];
  readonly resourcePreviews: Readonly<Record<string, DocumentResourcePreview>>;
}) {
  const { canvas, variableLabels, systemVariables, resourcePreviews } = input;
  const {
    placeholderLabel,
    imageLabel,
    imageBlockLabel,
    pageBreakLabel,
    buttonLabel,
    stepsLabel,
    imagesLabel,
  } = input.labels;
  const stableLabels = useStableByKey(variableLabels, JSON.stringify(variableLabels));
  const stableSystem = useStableByKey(systemVariables, systemVariables.join("\n"));
  const stablePreviews = useStableByKey(resourcePreviews, previewsKey(resourcePreviews));
  const extensions = useMemo(
    () =>
      createDocumentEditorExtensions({
        placeholder: placeholderLabel,
        image: imageLabel,
        pageBreak: pageBreakLabel,
        button: buttonLabel,
        steps: stepsLabel,
        images: imagesLabel,
        imageBlock: imageBlockLabel,
        variableLabels: stableLabels,
        systemVariables: stableSystem,
        resourcePreviews: stablePreviews,
        blockLabels: canvas,
      }),
    [
      placeholderLabel,
      imageLabel,
      imageBlockLabel,
      pageBreakLabel,
      buttonLabel,
      stepsLabel,
      imagesLabel,
      stableLabels,
      stableSystem,
      stablePreviews,
      canvas,
    ],
  );
  return { extensions, stableLabels };
}

export type DocumentTiptapModelInput = Pick<
  DocumentEditorProps,
  "id" | "value" | "onChange" | "readOnly" | "onEditorReady"
> & {
  readonly variableLabels: Readonly<Record<string, string>>;
  readonly systemVariables: readonly string[];
  readonly resourcePreviews: Readonly<Record<string, DocumentResourcePreview>>;
  readonly canvas: boolean;
};

export function useDocumentTiptapModel(input: DocumentTiptapModelInput, t: Translate) {
  const { id, value, onChange, readOnly } = input;
  const [openPanel, setOpenPanel] = useState<PanelKind | null>(null);
  const [canvasScroller, setCanvasScroller] = useState<HTMLElement | null>(null);
  const [showHtml, setShowHtml] = useState(false);
  const labels = documentEditorLabels(t);
  const { extensions, stableLabels } = useDocumentExtensions({
    labels,
    canvas: input.canvas,
    variableLabels: input.variableLabels,
    systemVariables: input.systemVariables,
    resourcePreviews: input.resourcePreviews,
  });

  // The node views are built from labels and previews, so a changed set
  // rebuilds the editor; its content is re-read from `value`.
  const editor = useEditor(
    {
      extensions,
      content: value,
      editable: !readOnly,
      // Suspense (DocumentContentEditor's lazy boundary) speculatively mounts
      // this component before committing it; immediate render would create an
      // editor instance during that throwaway pass.
      immediatelyRender: false,
      editorProps: { attributes: { id } },
      onUpdate: ({ editor: e }) => onChange(e.getHTML()),
    },
    [extensions],
  );
  useEditorHandleReport(editor, input.onEditorReady);

  // @tiptap/react v3 does not re-render on selection-only transactions, so
  // active states must come from a subscription.
  const activeState = useEditorState({
    editor,
    selector: ({ editor: e }) => (e === null ? null : activeStateOf(e, showHtml)),
  });

  return {
    openPanel,
    setOpenPanel,
    canvasScroller,
    setCanvasScroller,
    showHtml,
    setShowHtml,
    labels,
    stableLabels,
    editor,
    activeState,
  };
}
