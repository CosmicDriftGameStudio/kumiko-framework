// @runtime client
//
// Single-line editor for plain-text fields that carry {{placeholders}}
// (subject, preheader). The stored value stays plain text; placeholders show
// as chips while editing. Lives in the same lazy chunk as the document editor.

import { cn } from "@cosmicdrift/kumiko-renderer-web";
import { Extension, Node } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { type ReactNode, useMemo, useState } from "react";
import { DocumentVariable } from "../document-schema.js";
import { createVariableView } from "./document-editor-extensions.js";
import type { DocumentEditorHandle } from "./document-toolbar-blocks.js";
import { createEditorHandle } from "./editor-handle.js";
import { contentToLine, lineToContent, singleLine } from "./placeholder-text.js";
import { useStableByKey } from "./use-stable-by-key.js";

export type PlaceholderLineEditorProps = {
  readonly id: string;
  /** Plain text with `{{name}}` placeholders. */
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly variableLabels?: Readonly<Record<string, string>>;
  /** Placeholders shown as system chips (a different tint). */
  readonly systemVariables?: readonly string[];
  readonly readOnly?: boolean;
  readonly onEditorReady?: (handle: DocumentEditorHandle) => void;
  readonly "aria-label": string;
};

const LineDocument = Node.create({ name: "doc", topNode: true, content: "paragraph" });

// One line only: Enter must not split the paragraph.
const BlockLineBreaks = Extension.create({
  name: "blockLineBreaks",
  addKeyboardShortcuts() {
    return { Enter: () => true, "Shift-Enter": () => true, "Mod-Enter": () => true };
  },
});

const NO_LABELS: Readonly<Record<string, string>> = {};
const NO_NAMES: readonly string[] = [];

function LineEditorBody({
  id,
  initialValue,
  onChange,
  variableLabels,
  systemVariables,
  readOnly,
  onEditorReady,
  ariaLabel,
}: {
  readonly id: string;
  readonly initialValue: string;
  readonly onChange: (value: string) => void;
  readonly variableLabels: Readonly<Record<string, string>>;
  readonly systemVariables: readonly string[];
  readonly readOnly: boolean;
  readonly onEditorReady: ((handle: DocumentEditorHandle) => void) | undefined;
  readonly ariaLabel: string;
}): ReactNode {
  const extensions = useMemo(
    () => [
      LineDocument,
      StarterKit.configure({
        document: false,
        blockquote: false,
        bold: false,
        bulletList: false,
        code: false,
        codeBlock: false,
        dropcursor: false,
        gapcursor: false,
        hardBreak: false,
        heading: false,
        horizontalRule: false,
        italic: false,
        link: false,
        listItem: false,
        listKeymap: false,
        orderedList: false,
        strike: false,
        trailingNode: false,
        underline: false,
        undoRedo: false,
      }),
      DocumentVariable.extend({
        addNodeView: () => createVariableView(variableLabels, systemVariables),
      }),
      UndoRedo,
      BlockLineBreaks,
    ],
    [variableLabels, systemVariables],
  );

  const editor = useEditor({
    extensions,
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: lineToContent(initialValue) }],
    },
    editable: !readOnly,
    immediatelyRender: false,
    editorProps: {
      attributes: { id, role: "textbox", "aria-label": ariaLabel, "aria-multiline": "false" },
      transformPastedText: singleLine,
      // Rich pastes would bring several paragraphs; only their text is kept.
      transformPastedHTML: (html) => singleLine(html.replace(/<[^>]*>/g, " ")),
    },
    onCreate: ({ editor: created }) => onEditorReady?.(createEditorHandle(created)),
    onUpdate: ({ editor: e }) => onChange(contentToLine(e.getJSON().content?.[0]?.content)),
  });

  return (
    <EditorContent
      editor={editor}
      className={cn(
        "flex min-h-9 items-center rounded-md border border-input bg-transparent px-3 text-base md:text-sm",
        "[&_.ProseMirror]:w-full [&_.ProseMirror]:whitespace-nowrap [&_.ProseMirror]:outline-none",
        "[&_p]:m-0",
        readOnly && "opacity-60",
      )}
    />
  );
}

export default function PlaceholderLineEditor({
  id,
  value,
  onChange,
  variableLabels = NO_LABELS,
  systemVariables = NO_NAMES,
  readOnly = false,
  onEditorReady,
  "aria-label": ariaLabel,
}: PlaceholderLineEditorProps): ReactNode {
  const stableLabels = useStableByKey(variableLabels, JSON.stringify(variableLabels));
  const stableSystem = useStableByKey(systemVariables, systemVariables.join("\n"));

  // The text is the source of truth. Typing reports it through onChange and
  // keeps `emitted` equal to `value`; any other value (async load, reset)
  // remounts the editor body on the new text.
  const [emitted, setEmitted] = useState(value);
  const [epoch, setEpoch] = useState(0);
  if (value !== emitted) {
    setEmitted(value);
    setEpoch((current) => current + 1);
  }

  return (
    <LineEditorBody
      key={`${epoch}-${readOnly}-${JSON.stringify(stableLabels)}`}
      id={id}
      initialValue={value}
      onChange={(next) => {
        setEmitted(next);
        onChange(next);
      }}
      variableLabels={stableLabels}
      systemVariables={stableSystem}
      readOnly={readOnly}
      onEditorReady={onEditorReady}
      ariaLabel={ariaLabel}
    />
  );
}
