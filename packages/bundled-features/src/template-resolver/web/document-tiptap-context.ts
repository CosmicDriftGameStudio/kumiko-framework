import type { Translate } from "@cosmicdrift/kumiko-renderer/headless";
import type { Editor } from "@tiptap/core";
import type { Dispatch, SetStateAction } from "react";
import type { PrintDefaultLabels } from "./document-print-defaults.ts";
import {
  type ActiveState,
  BLOCK_PANEL,
  HEADING_LEVELS,
  insertPrintBlock,
  isParagraphStyle,
  type PanelKind,
  type Primitives,
  variableLabelOf,
} from "./document-tiptap-helpers.ts";
import type {
  DocumentPrintBlock,
  DocumentPrintMode,
  DocumentToolbarBlock,
} from "./document-toolbar-blocks.ts";
import type { DocumentEditorLabels } from "./use-document-tiptap-model.ts";

export type TiptapContext = {
  readonly id: string;
  readonly t: Translate;
  readonly Button: Primitives["Button"];
  readonly Field: Primitives["Field"];
  readonly Input: Primitives["Input"];
  readonly ActionOverflowMenu: Primitives["ActionOverflowMenu"];
  readonly editor: Editor;
  readonly readOnly: boolean;
  readonly canvas: boolean;
  readonly compact: boolean;
  readonly hosted: boolean;
  readonly print: DocumentPrintMode;
  readonly printDefaults: PrintDefaultLabels;
  readonly labels: DocumentEditorLabels;
  readonly activeState: ActiveState | null;
  readonly openPanel: PanelKind | null;
  readonly setOpenPanel: Dispatch<SetStateAction<PanelKind | null>>;
  readonly canvasScroller: HTMLElement | null;
  readonly setCanvasScroller: Dispatch<SetStateAction<HTMLElement | null>>;
  readonly showHtml: boolean;
  readonly setShowHtml: Dispatch<SetStateAction<boolean>>;
  readonly blocks: readonly DocumentToolbarBlock[];
  readonly variables: readonly string[];
  readonly imageVariables: readonly string[];
  readonly variableLabels: Readonly<Record<string, string>>;
  readonly stableLabels: Readonly<Record<string, string>>;
  readonly togglePanel: (kind: PanelKind) => void;
  readonly runBlock: (block: DocumentToolbarBlock) => void;
  readonly runPrintBlock: (block: DocumentPrintBlock) => void;
  readonly setBlockStyle: (style: string) => void;
  readonly repeatListLabel: string | undefined;
};

export type TiptapContextInput = Pick<
  TiptapContext,
  | "id"
  | "t"
  | "Button"
  | "Field"
  | "Input"
  | "ActionOverflowMenu"
  | "editor"
  | "readOnly"
  | "canvas"
  | "compact"
  | "hosted"
  | "print"
  | "printDefaults"
  | "labels"
  | "activeState"
  | "openPanel"
  | "setOpenPanel"
  | "canvasScroller"
  | "setCanvasScroller"
  | "showHtml"
  | "setShowHtml"
  | "blocks"
  | "variables"
  | "imageVariables"
  | "variableLabels"
  | "stableLabels"
>;

function repeatListLabelOf(
  activeState: ActiveState | null,
  variableLabels: Readonly<Record<string, string>>,
): string | undefined {
  const repeatTable = activeState?.repeatTable ?? null;
  return repeatTable !== null && repeatTable.lists.length === 1
    ? variableLabelOf(repeatTable.lists[0] ?? "", variableLabels)
    : undefined;
}

export function buildTiptapContext(input: TiptapContextInput): TiptapContext {
  const { editor, setOpenPanel } = input;
  const togglePanel = (kind: PanelKind): void =>
    setOpenPanel((current) => (current === kind ? null : kind));

  const setBlockStyle = (style: string): void => {
    // skip: not a paragraph style value
    if (!isParagraphStyle(style)) return;
    const chain = editor.chain().focus();
    if (style === "paragraph") chain.setParagraph().run();
    else chain.setHeading({ level: HEADING_LEVELS[style] }).run();
  };

  const runBlock = (block: DocumentToolbarBlock): void => {
    const panel = BLOCK_PANEL[block];
    if (panel) {
      togglePanel(panel);
      // skip: panel blocks open their panel instead of inserting directly
      return;
    }
    const chain = editor.chain().focus();
    if (block === "table") chain.insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run();
    else if (block === "divider") chain.insertContent({ type: "divider" }).run();
    else if (block === "pageBreak") chain.insertContent({ type: "pageBreak" }).run();
  };

  return {
    ...input,
    togglePanel,
    runBlock,
    runPrintBlock: (block) => insertPrintBlock(editor, block),
    setBlockStyle,
    repeatListLabel: repeatListLabelOf(input.activeState, input.variableLabels),
  };
}
