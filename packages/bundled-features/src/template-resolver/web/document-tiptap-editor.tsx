//
// tiptap-backed implementation behind DocumentContentEditor's lazy() boundary —
// never import this file statically, tiptap must only load when a "document"
// collection is rendered. Variables are inserted as `variable` nodes only,
// never as `{{name}}` text, so the sanitizer's schema keeps them.

import {
  TextareaContentEditor,
  useLocale,
  usePrimitives,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useEffect } from "react";
import { printDefaultLabelsOf } from "./document-print-defaults.ts";
import { renderEditorContent } from "./document-tiptap-content.tsx";
import { buildTiptapContext } from "./document-tiptap-context.ts";
import { NO_LABELS, NO_NAMES, NO_PREVIEWS, printModeOf } from "./document-tiptap-helpers.ts";
import { renderHostedEditor, renderInlineEditor } from "./document-tiptap-layout.tsx";
import {
  type DocumentEditorProps,
  type DocumentLayoutValues,
  MAIL_DOCUMENT_BLOCKS,
} from "./document-toolbar-blocks.ts";
import { useDocumentTiptapModel } from "./use-document-tiptap-model.ts";

const NO_LAYOUT_VALUES: DocumentLayoutValues = {};

export default function DocumentTiptapEditor({
  id,
  value,
  onChange,
  variables,
  readOnly,
  blocks: configuredBlocks = MAIL_DOCUMENT_BLOCKS,
  imageVariables = NO_NAMES,
  variableLabels = NO_LABELS,
  systemVariables = NO_NAMES,
  resourcePreviews = NO_PREVIEWS,
  chrome = "default",
  layoutValues = NO_LAYOUT_VALUES,
  toolbar = "full",
  renderPaper,
  toolbarHost,
  onEditorReady,
  onFrameControlChange,
}: DocumentEditorProps): ReactNode {
  const t = useTranslation();
  const locale = useLocale().locale();
  const { ActionOverflowMenu, Button, Field, Input } = usePrimitives();
  const canvas = chrome === "canvas";
  const compact = toolbar === "compact" && !canvas;
  const hosted = toolbarHost !== undefined;
  const print = printModeOf(configuredBlocks, hosted, canvas);
  // A photo block needs an images variable to bind to; without one the button would open an empty panel.
  const blocks =
    imageVariables.length === 0
      ? configuredBlocks.filter((block) => block !== "images")
      : configuredBlocks;

  const model = useDocumentTiptapModel(
    {
      id,
      value,
      onChange,
      readOnly,
      onEditorReady,
      onFrameControlChange,
      print,
      variableLabels,
      systemVariables,
      resourcePreviews,
      canvas,
    },
    t,
  );
  const { editor } = model;

  // The entry loads asynchronously, so `value` arrives after useEditor read
  // its initial content; the guard keeps in-flight typing from being clobbered.
  // When `extensions` change, useEditor's own effect destroys this render's
  // editor earlier in the same commit (a late validate result in the layout
  // editor does that); reading it then throws and unmounts the whole app. The
  // replacement editor re-renders and syncs `value` itself.
  // biome-ignore lint/plugin: DOM integration: syncs the controlled value into the imperative tiptap editor
  useEffect(() => {
    if (editor && !editor.isDestroyed && value !== editor.getHTML()) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [value, editor]);

  // biome-ignore lint/plugin: DOM integration: tiptap exposes editability only imperatively via setEditable
  useEffect(() => {
    // setEditable emits "update" by default, which would report the mount as an edit.
    if (editor && !editor.isDestroyed) editor.setEditable(!readOnly, false);
  }, [readOnly, editor]);

  // Read-only without chips: a textarea would insert {{name}} text and plaintext into a document body.
  if (!editor)
    return (
      <TextareaContentEditor id={id} value={value} onChange={onChange} variables={[]} readOnly />
    );

  const context = buildTiptapContext({
    id,
    t,
    Button,
    Field,
    Input,
    ActionOverflowMenu,
    editor,
    readOnly,
    canvas,
    compact,
    hosted,
    print,
    printDefaults: printDefaultLabelsOf(t, locale, layoutValues),
    labels: model.labels,
    activeState: model.activeState,
    openPanel: model.openPanel,
    setOpenPanel: model.setOpenPanel,
    canvasScroller: model.canvasScroller,
    setCanvasScroller: model.setCanvasScroller,
    showHtml: model.showHtml,
    setShowHtml: model.setShowHtml,
    blocks,
    variables,
    imageVariables,
    variableLabels,
    stableLabels: model.stableLabels,
  });
  const editorContent = renderEditorContent(editor, canvas, hosted, print);

  if (hosted) return renderHostedEditor(context, toolbarHost, editorContent);

  return renderInlineEditor(
    context,
    canvas && renderPaper !== undefined ? renderPaper(editorContent) : editorContent,
  );
}
